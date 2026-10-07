import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CancellationsService } from '../cancellations/cancellations.service.js';
import { haversineMeters } from '../common/geo.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { presentRide, rideInclude } from './ride.presenter.js';
import { RideSettings } from './rides.settings.js';

// A driver cannot hold two bookings closer together than this.
const RESERVATION_GAP_MS = 2 * 60 * 60_000;

// Bookings for later (Ride Later, scheduled freight) that drivers can take
// ahead of time, like Uber Reserve / inDrive City to City: drivers see them,
// send a price, the customer confirms one, and that driver gets the ride
// when it starts. Bookings nobody took are broadcast as usual shortly before
// the time (see MatchingService.tick).
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: RideSettings,
    private readonly cancellations: CancellationsService,
    private readonly events: DomainEvents,
  ) {}

  // The vehicle types this driver can take bookings for, and where they
  // were last (online or not), to show the bookings near them.
  private async driverContext(driverId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        status: 'approved',
        driverProfile: { userId: driverId, status: 'approved' },
      },
      select: { id: true, category: true },
    });
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y("location"::geometry) AS lat, ST_X("location"::geometry) AS lng
      FROM driver_presence
      WHERE "userId" = ${driverId}::uuid AND "location" IS NOT NULL`;
    return { vehicles, position: rows[0] ?? null };
  }

  // Bookings for later this driver could take: their vehicle types, near
  // where they were last, nobody confirmed yet, soonest first.
  async upcomingJobs(driverId: string) {
    const { vehicles, position } = await this.driverContext(driverId);
    if (!vehicles.length) return { items: [] };
    const rides = await this.prisma.ride.findMany({
      where: {
        status: 'scheduled',
        driverId: null,
        passengerId: { not: driverId },
        category: { in: [...new Set(vehicles.map((v) => v.category))] },
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
          distanceToPickupMeters: away,
          myOffer:
            mine && mine.status === 'bid' ? { amount: mine.bidAmount } : null,
        };
      })
      .filter(
        (job) =>
          job.distanceToPickupMeters == null ||
          job.distanceToPickupMeters <= this.settings.reservationRadiusMeters,
      );
    return { items };
  }

  // The bookings this driver is confirmed for, soonest first.
  async myReservations(driverId: string) {
    const rides = await this.prisma.ride.findMany({
      where: { status: 'scheduled', driverId },
      include: rideInclude,
      orderBy: { scheduledAt: 'asc' },
    });
    return { items: rides.map((r) => presentRide(r)) };
  }

  // Driver: offers a price for a booking ahead of time (or changes it). The
  // customer sees it with the other offers and may confirm it.
  async offer(driverId: string, rideId: string, amount: number) {
    await this.cancellations.assertNotBlocked(driverId, 'driver');
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.passengerId === driverId) {
      throw new NotFoundException('Booking not found');
    }
    if (ride.status !== 'scheduled' || ride.driverId) {
      throw new ConflictException('This booking is no longer open');
    }
    const { vehicles, position } = await this.driverContext(driverId);
    if (!vehicles.some((v) => v.category === ride.category)) {
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

  // Driver: gives up a booking they were confirmed for. It opens again for
  // other drivers' offers (and the broadcast before the time).
  async release(driverId: string, rideId: string) {
    const result = await this.prisma.ride.updateMany({
      where: { id: rideId, driverId, status: 'scheduled' },
      data: { driverId: null, vehicleId: null, fare: null },
    });
    if (!result.count) throw new NotFoundException('Booking not found');
    await this.prisma.rideOffer.updateMany({
      where: { rideId, driverId },
      data: { status: 'declined', respondedAt: new Date() },
    });
    this.events.emit('ride.reservation_released', { rideId, driverId });
    return { message: 'Booking released' };
  }

  // Customer: stops waiting for the confirmed driver (late, not answering).
  // The booking opens again; past its search time it goes to everyone
  // nearby on the next sweep.
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
    });
    return { message: 'Looking for another driver' };
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
    const vehicle = await tx.vehicle.findFirst({
      where: {
        category: ride.category,
        status: 'approved',
        driverProfile: { userId: offer.driverId, status: 'approved' },
      },
      select: { id: true },
    });
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
