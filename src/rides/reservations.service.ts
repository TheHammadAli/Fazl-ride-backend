import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { cooldownUntil } from '../cancellations/cancellation-policy.js';
import { CancellationsService } from '../cancellations/cancellations.service.js';
import { haversineMeters } from '../common/geo.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { BookingSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { bookingKind, startWindow } from './booking-rules.js';
import { BookingSettingsService } from './booking-settings.service.js';
import {
  presentRide,
  rideInclude,
  type RideWithRelations,
} from './ride.presenter.js';
import { RideSettings } from './rides.settings.js';
import { VehicleCategoriesService } from '../vehicle-categories/vehicle-categories.service.js';
import { VehicleTiersService } from '../vehicle-categories/vehicle-tiers.service.js';
import { isOpenTier } from '../vehicle-categories/vehicle-tiers.js';

// A driver cannot hold two bookings closer together than this.
const RESERVATION_GAP_MS = 2 * 60 * 60_000;

// Marks the cancellation rows that count against a driver's bookings (not
// against the cool-down for rides wanted now).
export const BOOKING_STRIKE = 'booking:';

// Bookings for later (Ride Later, scheduled freight), inDrive style: drivers
// see open bookings near where they were last, send a price, the customer
// confirms one, and on the day that driver presses Start themselves. Nothing
// is dispatched automatically: if the driver does not come, the customer
// decides (call, get other offers, or cancel).
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: RideSettings,
    private readonly bookings: BookingSettingsService,
    private readonly cancellations: CancellationsService,
    private readonly events: DomainEvents,
    private readonly tiers: VehicleTiersService,
    private readonly categories: VehicleCategoriesService,
  ) {}

  // The start window of a booking, for the ride view and the apps.
  bookingView(
    ride: { scheduledAt: Date | null; service: string; tripType: string },
    s: BookingSettings,
  ) {
    if (!ride.scheduledAt) return null;
    const kind = bookingKind(ride.service, ride.tripType);
    const window = startWindow(ride.scheduledAt, kind, s);
    return { kind, startFrom: window.from, startUntil: window.until };
  }

  async present(ride: RideWithRelations) {
    const s = await this.bookings.get();
    return { ...presentRide(ride), booking: this.bookingView(ride, s) };
  }

  // The vehicle types this driver can take bookings for, and where they
  // were last (online or not), to show the bookings near them.
  private async driverContext(driverId: string) {
    const approved = await this.prisma.vehicle.findMany({
      where: {
        status: 'approved',
        driverProfile: { userId: driverId, status: 'approved' },
      },
    });
    // Each with every ride type it may take (tiers included).
    const vehicles = await Promise.all(
      approved.map(async (v) => ({
        id: v.id,
        serves: await this.tiers.servingFor(v),
      })),
    );
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng
      FROM driver_presence
      WHERE "userId" = ${driverId}::uuid AND "location" IS NOT NULL`;
    return { vehicles, position: rows[0] ?? null };
  }

  // Not coming to a confirmed booking, or giving it up at the last minute,
  // too often in a while: no bookings for some days.
  async bookingBlockedUntil(driverId: string, now = new Date()) {
    const s = await this.bookings.get();
    const day = 24 * 60 * 60_000;
    const since = new Date(
      now.getTime() - (s.noShowWindowDays + s.noShowBlockDays) * day,
    );
    const strikes = await this.prisma.rideCancellation.findMany({
      where: {
        userId: driverId,
        role: 'driver',
        fromStatus: 'scheduled',
        reason: { startsWith: BOOKING_STRIKE },
        forgivenAt: null,
        createdAt: { gt: since },
      },
      select: { createdAt: true },
    });
    return cooldownUntil(
      strikes.map((r) => r.createdAt),
      now,
      {
        limit: s.noShowLimit,
        windowMs: s.noShowWindowDays * day,
        cooldownMs: s.noShowBlockDays * day,
      },
    );
  }

  private async assertMayBook(driverId: string) {
    await this.cancellations.assertNotBlocked(driverId, 'driver');
    const until = await this.bookingBlockedUntil(driverId);
    if (until) {
      throw new ForbiddenException({
        code: 'BOOKINGS_BLOCKED',
        message:
          'You missed too many bookings. You can take bookings again later.',
        blockedUntil: until,
      });
    }
  }

  // Bookings for later this driver could take: their vehicle types, near
  // where they were last, nobody confirmed yet, soonest first.
  async upcomingJobs(driverId: string) {
    const blockedUntil = await this.bookingBlockedUntil(driverId);
    if (blockedUntil) return { items: [], blockedUntil };
    const { vehicles, position } = await this.driverContext(driverId);
    if (!vehicles.length) return { items: [], blockedUntil: null };
    const s = await this.bookings.get();
    const rides = await this.prisma.ride.findMany({
      where: {
        status: 'scheduled',
        driverId: null,
        passengerId: { not: driverId },
        category: { in: [...new Set(vehicles.flatMap((v) => v.serves))] },
        scheduledAt: { gt: new Date() },
      },
      include: { ...rideInclude, offers: { where: { driverId } } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    });
    const items = rides
      .map((ride) => {
        const away = position
          ? Math.round(
              haversineMeters(position, {
                lat: ride.pickupLat,
                lng: ride.pickupLng,
              }),
            )
          : null;
        const mine = ride.offers[0];
        return {
          ...presentRide(ride),
          booking: this.bookingView(ride, s),
          distanceToPickupMeters: away,
          myOffer:
            mine && mine.status === 'bid' ? { amount: mine.bidAmount } : null,
        };
      })
      .filter(
        (job) =>
          job.distanceToPickupMeters == null ||
          job.distanceToPickupMeters <= s.reservationRadiusKm * 1000,
      );
    return { items, blockedUntil: null };
  }

  // The bookings this driver is confirmed for, soonest first.
  async myReservations(driverId: string) {
    const rides = await this.prisma.ride.findMany({
      where: { status: 'scheduled', driverId },
      include: rideInclude,
      orderBy: { scheduledAt: 'asc' },
    });
    const s = await this.bookings.get();
    return {
      items: rides.map((r) => ({
        ...presentRide(r),
        booking: this.bookingView(r, s),
      })),
    };
  }

  // Drivers to tell about a new booking: an approved vehicle of its type,
  // and last seen near its pickup (or never seen yet).
  async driversFor(ride: {
    id: string;
    passengerId: string;
    category: string;
    pickupLat: number;
    pickupLng: number;
  }) {
    const s = await this.bookings.get();
    // A tier: vehicles of its base type, approved for it unless it is open.
    const type = (await this.categories.allForTiers()).find(
      (c) => c.key === ride.category,
    );
    const base = type?.parentKey ?? ride.category;
    const anyOfBase = !type?.parentKey || (type ? isOpenTier(type) : true);
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      SELECT DISTINCT dp."userId" AS "userId"
      FROM vehicles v
      JOIN driver_profiles dp ON dp.id = v."driverProfileId"
      LEFT JOIN driver_presence p ON p."userId" = dp."userId"
      WHERE v.category = ${base} AND v.status = 'approved'
        AND (${anyOfBase}::boolean OR ${ride.category} = ANY(v.tiers))
        AND NOT (${ride.category} = ANY(v."tiersOff"))
        AND dp.status = 'approved' AND dp."userId" <> ${ride.passengerId}::uuid
        AND (p."location" IS NULL OR ST_DWithin(
          p."location",
          ST_SetSRID(ST_MakePoint(${ride.pickupLng}, ${ride.pickupLat}), 4326)::geography,
          ${s.reservationRadiusKm * 1000}))
      LIMIT 300`;
    return rows.map((r) => r.userId);
  }

  // Driver: offers a price for a booking ahead of time (or changes it). The
  // customer sees it with the other offers and may confirm it.
  async offer(driverId: string, rideId: string, amount: number) {
    await this.assertMayBook(driverId);
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.passengerId === driverId) {
      throw new NotFoundException('Booking not found');
    }
    if (ride.status !== 'scheduled' || ride.driverId) {
      throw new ConflictException('This booking is no longer open');
    }
    const { vehicles, position } = await this.driverContext(driverId);
    if (!vehicles.some((v) => v.serves.includes(ride.category))) {
      throw new ConflictException('You have no approved vehicle of this type');
    }
    const min = Math.round(
      ride.estimatedFare * this.settings.negotiationMinFareFraction,
    );
    if (amount < min) {
      throw new BadRequestException(
        `The price can not be lower than Rs ${min}`,
      );
    }
    const away = position
      ? Math.round(
          haversineMeters(position, {
            lat: ride.pickupLat,
            lng: ride.pickupLng,
          }),
        )
      : 0;
    await this.prisma.rideOffer.upsert({
      where: { rideId_driverId: { rideId, driverId } },
      create: {
        rideId,
        driverId,
        status: 'bid',
        bidAmount: amount,
        distanceToPickupMeters: away,
        etaSeconds: 0,
        expiresAt: ride.expiresAt,
      },
      update: {
        status: 'bid',
        bidAmount: amount,
        expiresAt: ride.expiresAt,
        respondedAt: new Date(),
      },
    });
    this.events.emit('ride.bid.received', { rideId, driverId });
    return { message: 'Offer sent. The customer will confirm a driver.' };
  }

  // Driver, on the day: heading to the pickup now. The booking becomes an
  // ordinary ride (accepted -> arrived -> started -> completed).
  async start(driverId: string, rideId: string, now = new Date()) {
    const ride = await this.prisma.ride.findFirst({
      where: { id: rideId, driverId, status: 'scheduled' },
    });
    if (!ride?.scheduledAt) throw new NotFoundException('Booking not found');
    const s = await this.bookings.get();
    const window = startWindow(
      ride.scheduledAt,
      bookingKind(ride.service, ride.tripType),
      s,
    );
    if (now < window.from) {
      throw new ConflictException({
        code: 'BOOKING_TOO_EARLY',
        message: 'It is too early to start this booking',
        startFrom: window.from,
      });
    }
    if (now > window.until) {
      throw new ConflictException('The time to start this booking has passed');
    }
    const presence = await this.prisma.driverPresence.findUnique({
      where: { userId: driverId },
      select: { isOnline: true, busy: true, category: true, categories: true },
    });
    const serves = presence?.categories.length
      ? presence.categories
      : [presence?.category];
    if (!presence?.isOnline || !serves.includes(ride.category)) {
      throw new ConflictException({
        code: 'GO_ONLINE_FIRST',
        message: `Go online with your ${ride.category} first`,
      });
    }
    if (presence.busy) {
      throw new ConflictException('Finish your current ride first');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const done = await tx.ride.updateMany({
          where: { id: rideId, driverId, status: 'scheduled' },
          data: { status: 'accepted', acceptedAt: now },
        });
        if (!done.count) {
          throw new ConflictException('This booking just changed; refresh it');
        }
        await tx.$executeRaw`
          UPDATE driver_presence SET "busy" = true, "updatedAt" = now()
          WHERE "userId" = ${driverId}::uuid`;
      });
    } catch (error: any) {
      // The customer is on another ride right now (one active ride each).
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'The customer is on another ride right now; call them',
        );
      }
      throw error;
    }
    this.events.emit('ride.accepted', { rideId, driverId });
  }

  // Driver: gives up a booking they were confirmed for. It opens again for
  // other drivers' offers. Close to the time it counts against them.
  async release(driverId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({
      where: { id: rideId, driverId, status: 'scheduled' },
      select: { scheduledAt: true },
    });
    if (!ride) throw new NotFoundException('Booking not found');
    const s = await this.bookings.get();
    const late =
      ride.scheduledAt != null &&
      ride.scheduledAt.getTime() - Date.now() < s.lateReleaseMinutes * 60_000;
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.ride.updateMany({
        where: { id: rideId, driverId, status: 'scheduled' },
        data: { driverId: null, vehicleId: null, fare: null },
      });
      if (!result.count) throw new NotFoundException('Booking not found');
      await tx.rideOffer.updateMany({
        where: { rideId, driverId },
        data: { status: 'declined', respondedAt: new Date() },
      });
      if (late) {
        await this.cancellations.record(tx, {
          rideId,
          userId: driverId,
          role: 'driver',
          fromStatus: 'scheduled',
          reason: `${BOOKING_STRIKE} late release`,
        });
      }
    });
    this.events.emit('ride.reservation_released', {
      rideId,
      driverId,
      by: 'driver',
    });
    return {
      message: late
        ? 'Booking released. Giving up this close to the time counts against you.'
        : 'Booking released',
    };
  }

  // Customer: stops waiting for the confirmed driver (late, not answering).
  // The booking opens again for other drivers' offers.
  async findAnotherDriver(passengerId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({
      where: { id: rideId, passengerId, status: 'scheduled' },
      select: { driverId: true },
    });
    if (!ride?.driverId) throw new NotFoundException('Booking not found');
    const result = await this.prisma.ride.updateMany({
      where: { id: rideId, driverId: ride.driverId, status: 'scheduled' },
      data: { driverId: null, vehicleId: null, fare: null },
    });
    if (!result.count) {
      throw new ConflictException('This booking just changed; refresh it');
    }
    await this.prisma.rideOffer.updateMany({
      where: { rideId, driverId: ride.driverId },
      data: { status: 'declined', respondedAt: new Date() },
    });
    this.events.emit('ride.reservation_released', {
      rideId,
      driverId: ride.driverId,
      by: 'passenger',
    });
    return { message: 'Other drivers can offer again' };
  }

  // Part of the customer's choose: confirms [driverId] for a booking ahead of
  // time. Runs inside choose's transaction with the ride locked.
  async confirmInTx(
    tx: Pick<PrismaService, 'ride' | 'rideOffer' | 'vehicle'>,
    ride: { id: string; category: string },
    offer: { id: string; driverId: string },
    amount: number,
  ) {
    const booked = await tx.ride.findUnique({
      where: { id: ride.id },
      select: { scheduledAt: true },
    });
    const at = booked?.scheduledAt?.getTime() ?? Date.now();
    const clash = await tx.ride.count({
      where: {
        driverId: offer.driverId,
        status: 'scheduled',
        id: { not: ride.id },
        scheduledAt: {
          gt: new Date(at - RESERVATION_GAP_MS),
          lt: new Date(at + RESERVATION_GAP_MS),
        },
      },
    });
    if (clash) {
      throw new ConflictException(
        'That driver is booked around that time; pick another offer',
      );
    }
    const candidates = await tx.vehicle.findMany({
      where: {
        status: 'approved',
        driverProfile: { userId: offer.driverId, status: 'approved' },
      },
    });
    let vehicle: { id: string } | null = null;
    for (const v of candidates) {
      if ((await this.tiers.servingFor(v)).includes(ride.category)) {
        vehicle = v;
        break;
      }
    }
    if (!vehicle) {
      throw new ConflictException(
        'That driver can no longer take this booking',
      );
    }
    const now = new Date();
    await tx.rideOffer.update({
      where: { id: offer.id },
      data: { status: 'accepted', respondedAt: now },
    });
    await tx.rideOffer.updateMany({
      where: {
        rideId: ride.id,
        id: { not: offer.id },
        status: { in: ['pending', 'bid'] },
      },
      data: { status: 'closed', respondedAt: now },
    });
    await tx.ride.update({
      where: { id: ride.id },
      data: { driverId: offer.driverId, vehicleId: vehicle.id, fare: amount },
    });
  }
}
