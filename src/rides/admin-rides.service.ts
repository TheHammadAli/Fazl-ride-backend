import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { RideStatus } from '../generated/prisma/enums.js';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  STALE_MESSAGE,
  type StaleLimits,
  type StaleReason,
  staleReason,
} from './stale-rides.js';
import { ListRidesDto } from './dto/admin-rides.dto.js';
import { ratingView } from './rating.js';

const person = { select: { id: true, name: true, phone: true } } as const;

// Under way right now: looking for a driver, or a driver is on it.
const ACTIVE: RideStatus[] = ['requested', 'accepted', 'arrived', 'started'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Addresses, the passenger's or driver's name/phone, or a whole ride id.
function rideSearch(q: string): Prisma.RideWhereInput[] {
  const text = { contains: q, mode: 'insensitive' as const };
  return [
    { pickupAddress: text },
    { dropoffAddress: text },
    { passenger: { OR: [{ name: text }, { phone: { contains: q } }] } },
    { driver: { OR: [{ name: text }, { phone: { contains: q } }] } },
    ...(UUID.test(q) ? [{ id: q.toLowerCase() }] : []),
  ];
}

interface LockedRide {
  status: RideStatus;
  driverId: string | null;
  passengerId: string;
  requestedAt: Date;
  acceptedAt: Date | null;
  startedAt: Date | null;
}

// What an admin may stop (a finished ride is history).
const CANCELLABLE: RideStatus[] = ['scheduled', ...ACTIVE];

@Injectable()
export class AdminRidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}

  async list(q: ListRidesDto) {
    const search = q.search?.trim();
    const where: Prisma.RideWhereInput = {
      ...(q.status
        ? { status: q.status }
        : q.active && { status: { in: ACTIVE } }),
      ...(search && { OR: rideSearch(search) }),
      ...(q.category && { category: q.category }),
      ...(q.tripType && { tripType: q.tripType }),
      ...(q.passengerId && { passengerId: q.passengerId }),
      ...(q.driverId && { driverId: q.driverId }),
      ...((q.from || q.to) && {
        requestedAt: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: new Date(q.to) }),
        },
      }),
    };
    const [rides, total] = await Promise.all([
      this.prisma.ride.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { passenger: person, driver: person },
      }),
      this.prisma.ride.count({ where }),
    ]);
    return {
      items: rides.map((r) => ({
        id: r.id,
        status: r.status,
        category: r.category,
        tripType: r.tripType,
        service: r.service,
        pickupAddress: r.pickupAddress,
        dropoffAddress: r.dropoffAddress,
        pickup: { lat: r.pickupLat, lng: r.pickupLng },
        dropoff: { lat: r.dropoffLat, lng: r.dropoffLng },
        estimatedFare: r.estimatedFare,
        offeredFare: r.offeredFare,
        paymentMethod: r.paymentMethod,
        scheduledAt: r.scheduledAt,
        fare: r.fare,
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        cancelledBy: r.cancelledBy,
        cancelledFromStatus: r.cancelledFromStatus,
        requestedAt: r.requestedAt,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
        passenger: r.passenger,
        driver: r.driver,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  // Everything about one ride, for support and disputes.
  async get(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        passenger: {
          select: {
            id: true,
            name: true,
            phone: true,
            ratingSum: true,
            ratingCount: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            ratingSum: true,
            ratingCount: true,
          },
        },
        vehicle: true,
        offers: { orderBy: { offeredAt: 'asc' } },
        ratings: { orderBy: { createdAt: 'asc' } },
        cancellationLog: { orderBy: { createdAt: 'asc' } },
        earningEntries: true,
      },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return {
      ...ride,
      passenger: {
        ...ride.passenger,
        rating: ratingView(
          ride.passenger.ratingSum,
          ride.passenger.ratingCount,
        ),
      },
      driver: ride.driver
        ? {
            ...ride.driver,
            rating: ratingView(ride.driver.ratingSum, ride.driver.ratingCount),
          }
        : null,
    };
  }

  // Support stops a ride that is stuck or wrong (e.g. the driver vanished).
  // Nobody gets a cancellation strike; both people are told.
  async cancel(adminId: string, rideId: string, reason: string) {
    const closed = await this.close(rideId, {
      reasonText: `Cancelled by FAZL support: ${reason}`,
    });
    if (!closed) throw new NotFoundException('Ride not found');
    await this.audit.log(adminId, 'ride.admin_cancel', 'ride', rideId, {
      from: closed.from,
      reason,
    });
    this.events.emit('ride.cancelled', { ...closed, rideId, by: 'admin' });
    return this.get(rideId);
  }

  // The stale-ride sweeper: closes the ride only if it is still stale once
  // locked (a position that arrived meanwhile wins). True when closed.
  async closeStale(rideId: string, now: Date, limits: StaleLimits) {
    let reason: StaleReason | null = null;
    const closed = await this.close(rideId, {
      reasonText: () => (reason ? STALE_MESSAGE[reason] : ''),
      stillWanted: async (tx, ride) => {
        const [seen] = await tx.$queryRaw<{ at: Date | null }[]>`
          SELECT "locationUpdatedAt" AS at FROM driver_presence
          WHERE "userId" = ${ride.driverId}::uuid`;
        reason = staleReason(
          { ...ride, driverSeenAt: seen?.at ?? null },
          now,
          limits,
        );
        return reason !== null;
      },
    });
    if (!closed || !reason) return false;
    await this.audit.log(null, 'ride.auto_close', 'ride', rideId, {
      from: closed.from,
      reason,
    });
    this.events.emit('ride.cancelled', {
      ...closed,
      rideId,
      by: 'system',
      reason,
      message: STALE_MESSAGE[reason],
    });
    await this.adminNotifications.create({
      type: 'ride_closed',
      title:
        reason === 'driver_lost'
          ? 'Ride closed: driver lost connection'
          : reason === 'trip_lost'
            ? 'Trip closed: no location for 2 hours'
            : 'Ride closed: open too long',
      body: 'Closed automatically. Check whether the trip happened and if any payment needs fixing.',
      targetType: 'ride',
      targetId: rideId,
    });
    return true;
  }

  // Cancels a ride that is not finished yet, inside one locked transaction:
  // offers expired, driver freed. Null when it was not cancellable (or the
  // check said no).
  private async close(
    rideId: string,
    opts: {
      reasonText: string | (() => string);
      stillWanted?: (
        tx: Prisma.TransactionClient,
        ride: LockedRide,
      ) => Promise<boolean>;
    },
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedRide[]>`
        SELECT status, "driverId", "passengerId", "requestedAt", "acceptedAt",
               "startedAt"
        FROM rides WHERE id = ${rideId}::uuid FOR UPDATE`;
      const ride = rows[0];
      if (!ride) {
        if (opts.stillWanted) return null;
        throw new NotFoundException('Ride not found');
      }
      if (!CANCELLABLE.includes(ride.status)) {
        if (opts.stillWanted) return null;
        throw new ConflictException(
          `A ride that is ${ride.status} can not be cancelled`,
        );
      }
      if (opts.stillWanted && !(await opts.stillWanted(tx, ride))) return null;
      await tx.ride.update({
        where: { id: rideId },
        data: {
          status: 'cancelled',
          cancelledBy: 'system',
          cancelledFromStatus: ride.status,
          cancelReason:
            typeof opts.reasonText === 'string'
              ? opts.reasonText
              : opts.reasonText(),
          cancelledAt: now,
        },
      });
      await tx.rideOffer.updateMany({
        where: { rideId, status: { in: ['pending', 'bid'] } },
        data: { status: 'expired', respondedAt: now },
      });
      if (ride.driverId && ride.status !== 'scheduled') {
        // The driver is free to take another ride.
        await tx.$executeRaw`
          UPDATE driver_presence SET busy = false, "updatedAt" = now()
          WHERE "userId" = ${ride.driverId}::uuid`;
      }
      return {
        from: ride.status,
        driverId: ride.driverId,
        passengerId: ride.passengerId,
      };
    });
  }
}
