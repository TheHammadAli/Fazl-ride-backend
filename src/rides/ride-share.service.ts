import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RideStatus } from '../generated/prisma/enums.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { ratingView } from './rating.js';

// A ride can be shared from the moment it is booked until it ends.
const SHAREABLE: RideStatus[] = [
  'scheduled',
  'requested',
  'accepted',
  'arrived',
  'started',
];
const DRIVER_ACTIVE: RideStatus[] = ['accepted', 'arrived', 'started'];
// A link lives a day (from the booked time for a ride booked for later)...
const LINK_HOURS = 24;
// ...but stops showing a ride an hour after it ended.
const AFTER_END_MS = 60 * 60_000;
const TOUCH_EVERY_MS = 60_000;

// "Share my trip" (Careem/Uber/inDrive): family and friends follow one ride
// in a browser, without an account. The link shows where the car is, the
// route, the driver's first name and the car and plate - never a phone
// number, an id or anything about the other trips of either person.
@Injectable()
export class RideShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: DriverLocationStore,
    private readonly routing: RoutingProvider,
  ) {}

  // The passenger or the driver on the ride makes a link to send.
  async create(userId: string, rideId: string, baseUrl: string) {
    const ride = await this.prisma.ride.findFirst({
      where: {
        id: rideId,
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
      select: { status: true, scheduledAt: true },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (!SHAREABLE.includes(ride.status)) {
      throw new ConflictException('This ride has ended and cannot be shared');
    }
    const token = `trp_${randomBytes(24).toString('base64url')}`;
    const from = Math.max(Date.now(), ride.scheduledAt?.getTime() ?? 0);
    const expiresAt = new Date(from + LINK_HOURS * 3600_000);
    await this.prisma.rideShareLink.create({
      data: { rideId, createdById: userId, tokenHash: hash(token), expiresAt },
    });
    return { url: `${baseUrl.replace(/\/+$/, '')}/t/${token}`, expiresAt };
  }

  // Stops every link to this ride working (for example sent to the wrong person).
  async revokeAll(userId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({
      where: {
        id: rideId,
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
      select: { id: true },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    const result = await this.prisma.rideShareLink.updateMany({
      where: { rideId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  // What the browser page shows. 404 for an unknown link, 410 once it no
  // longer shows anything.
  async view(token: string) {
    const link = token.startsWith('trp_')
      ? await this.prisma.rideShareLink.findUnique({
          where: { tokenHash: hash(token) },
        })
      : null;
    if (!link) throw new NotFoundException('This link is not valid');
    const now = Date.now();
    if (link.revokedAt || link.expiresAt.getTime() < now) {
      throw new GoneException('This link has expired');
    }
    const ride = await this.prisma.ride.findUniqueOrThrow({
      where: { id: link.rideId },
      include: {
        passenger: { select: { name: true } },
        driver: { select: { name: true, ratingSum: true, ratingCount: true } },
        vehicle: {
          select: { make: true, model: true, color: true, plateNumber: true },
        },
        categoryRef: { select: { label: true } },
        stops: {
          orderBy: { position: 'asc' },
          select: {
            lat: true,
            lng: true,
            address: true,
            arrivedAt: true,
            departedAt: true,
          },
        },
      },
    });
    const endedAt = ride.completedAt ?? ride.cancelledAt;
    const ended = !SHAREABLE.includes(ride.status);
    if (ended && (endedAt?.getTime() ?? 0) + AFTER_END_MS < now) {
      throw new GoneException('This trip has ended');
    }
    if (!link.lastUsedAt || now - link.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      void this.prisma.rideShareLink
        .update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    const live = ride.driverId != null && DRIVER_ACTIVE.includes(ride.status);
    const position = live
      ? await this.locations.getLocation(ride.driverId!)
      : null;
    // On the way to the pickup: time to the pickup; on the trip: to the drop-off.
    let etaSeconds: number | null = null;
    if (position && (ride.status === 'accepted' || ride.status === 'started')) {
      const target =
        ride.status === 'accepted'
          ? { lat: ride.pickupLat, lng: ride.pickupLng }
          : { lat: ride.dropoffLat, lng: ride.dropoffLng };
      etaSeconds = (await this.routing.route(position, target)).durationSeconds;
    }

    return {
      status: ride.status,
      service: ride.service,
      vehicleType: ride.categoryRef.label,
      rider: firstName(ride.riderName ?? ride.passenger.name),
      pickup: {
        lat: ride.pickupLat,
        lng: ride.pickupLng,
        address: ride.pickupAddress,
      },
      dropoff: {
        lat: ride.dropoffLat,
        lng: ride.dropoffLng,
        address: ride.dropoffAddress,
      },
      stops: ride.stops,
      driver:
        ride.driver && ride.status !== 'scheduled'
          ? {
              name: firstName(ride.driver.name),
              rating: ratingView(
                ride.driver.ratingSum,
                ride.driver.ratingCount,
              ),
              vehicle: ride.vehicle,
            }
          : null,
      driverLocation: position
        ? { lat: position.lat, lng: position.lng, heading: position.heading }
        : null,
      etaSeconds,
      scheduledAt: ride.scheduledAt,
      requestedAt: ride.requestedAt,
      acceptedAt: ride.acceptedAt,
      arrivedAt: ride.arrivedAt,
      startedAt: ride.startedAt,
      completedAt: ride.completedAt,
      cancelledAt: ride.cancelledAt,
      linkExpiresAt: link.expiresAt,
    };
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

// Only a first name goes out on a public link.
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}
