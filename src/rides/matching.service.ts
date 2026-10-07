import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.service.js';
import { DestinationService } from '../presence/destination.service.js';
import { takesTowardsDestination } from '../presence/destination-rule.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { RideSettings } from './rides.settings.js';
import { WalletService } from '../wallet/wallet.service.js';

// Only one app instance runs a tick at a time (Postgres advisory lock), so the
// sweeper stays correct if the API is scaled to several instances.
const SWEEPER_LOCK_ID = 727_001;

export interface OfferableRide {
  id: string;
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  category: string;
  searchRadiusMeters: number;
  // Bidding rides broadcast to everyone in range instead of a handful of the
  // nearest drivers; see RideSettings.negotiableOffersLimit.
  negotiable?: boolean;
  // 'freight' asks drivers further away and gives them longer to answer.
  service?: string;
}

@Injectable()
export class MatchingService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MatchingService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: DriverLocationStore,
    private readonly routing: RoutingProvider,
    private readonly settings: RideSettings,
    private readonly events: DomainEvents,
    private readonly destinations: DestinationService,
    private readonly wallet: WalletService,
  ) {}

  onApplicationBootstrap() {
    if (!this.settings.sweeperEnabled) return;
    this.timer = setInterval(() => void this.safeTick(), this.settings.tickMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async offerRide(ride: OfferableRide): Promise<number> {
    const asked = await this.prisma.rideOffer.findMany({
      where: { rideId: ride.id },
      select: { driverId: true },
    });
    const skip = new Set([...asked.map((a) => a.driverId), ride.passengerId]);
    // Fixed-price rides go to a handful of the nearest drivers; a negotiable
    // ride is broadcast to everyone in range, so it can collect several bids.
    const perRound = ride.negotiable
      ? this.settings.negotiableOffersLimit
      : this.settings.offersPerRound;
    const nearby = await this.locations.findNearby({
      lat: ride.pickupLat,
      lng: ride.pickupLng,
      radiusMeters: ride.searchRadiusMeters,
      category: ride.category,
      limit: perRound + skip.size,
    });
    // Drivers owing commission past the limit get nothing new until they top up.
    const owing = await this.wallet.withDues(nearby.map((d) => d.userId));
    const candidates = nearby.filter(
      (d) => !skip.has(d.userId) && !owing.has(d.userId),
    );
    // Drivers in destination mode only get rides that take them that way.
    const destinations = await this.destinations.activeFor(
      candidates.map((d) => d.userId),
    );
    const pickupAt = { lat: ride.pickupLat, lng: ride.pickupLng };
    const dropoffAt = { lat: ride.dropoffLat, lng: ride.dropoffLng };
    const chosen = candidates
      .filter((d) => {
        const destination = destinations.get(d.userId);
        return (
          !destination ||
          takesTowardsDestination(
            { lat: d.lat, lng: d.lng },
            pickupAt,
            dropoffAt,
            destination,
          )
        );
      })
      .slice(0, perRound);
    if (!chosen.length) return 0;

    const expiresAt = new Date(Date.now() + this.offerTtlSeconds(ride) * 1000);
    const pickup = { lat: ride.pickupLat, lng: ride.pickupLng };
    const data = await Promise.all(
      chosen.map(async (d) => {
        const route = await this.routing.route(
          { lat: d.lat, lng: d.lng },
          pickup,
        );
        return {
          rideId: ride.id,
          driverId: d.userId,
          distanceToPickupMeters: route.distanceMeters,
          etaSeconds: route.durationSeconds,
          expiresAt,
        };
      }),
    );
    await this.prisma.rideOffer.createMany({ data, skipDuplicates: true });
    for (const offer of data) {
      this.events.emit('ride.offer.created', {
        rideId: ride.id,
        driverId: offer.driverId,
        etaSeconds: offer.etaSeconds,
        expiresAt,
      });
    }
    return data.length;
  }

  offerTtlSeconds(ride: { service?: string }) {
    return ride.service === 'freight'
      ? this.settings.freightOfferTtlSeconds
      : this.settings.offerTtlSeconds;
  }

  // Expires stale requests and offers, and widens the search for rides nobody took yet.
  async tick(now = new Date()) {
    const expiredRideIds: string[] = [];
    const dispatchedRideIds: string[] = [];
    const assigned: { rideId: string; driverId: string }[] = [];
    const released: { rideId: string; driverId: string }[] = [];
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SWEEPER_LOCK_ID}::bigint) AS locked`;
        if (!locked) return { skipped: true, expired: 0, widened: 0 };

        const expiring = await tx.ride.findMany({
          where: { status: 'requested', expiresAt: { lte: now } },
          select: { id: true },
        });
        if (expiring.length) {
          const ids = expiring.map((r) => r.id);
          await tx.ride.updateMany({
            where: { id: { in: ids }, status: 'requested' },
            data: {
              status: 'expired',
              cancelledBy: 'system',
              cancelledAt: now,
            },
          });
          await tx.rideOffer.updateMany({
            where: { rideId: { in: ids }, status: 'pending' },
            data: { status: 'expired', respondedAt: now },
          });
          expiredRideIds.push(...ids);
        }

        await tx.rideOffer.updateMany({
          where: { status: 'pending', expiresAt: { lte: now } },
          data: { status: 'expired', respondedAt: now },
        });

        // Bookings for later whose search should start now. If the customer
        // is already on another ride by then, this one cannot go ahead.
        const starting = await tx.ride.findMany({
          where: { status: 'scheduled', dispatchAt: { lte: now } },
          select: {
            id: true,
            passengerId: true,
            service: true,
            driverId: true,
            category: true,
            scheduledAt: true,
          },
        });
        for (const booking of starting) {
          const busy = await tx.ride.count({
            where: {
              passengerId: booking.passengerId,
              status: { in: ['requested', 'accepted', 'arrived', 'started'] },
            },
          });
          if (busy) {
            await tx.ride.update({
              where: { id: booking.id },
              data: {
                status: 'expired',
                cancelledBy: 'system',
                cancelReason: 'You were on another ride at the booked time',
                cancelledAt: now,
              },
            });
            expiredRideIds.push(booking.id);
            continue;
          }
          // A driver confirmed ahead of time gets the ride now, if they are
          // online and free with a vehicle of the right type.
          if (booking.driverId) {
            const ready = await tx.$executeRaw`
              UPDATE driver_presence SET "busy" = true, "updatedAt" = now()
              WHERE "userId" = ${booking.driverId}::uuid AND "isOnline"
                AND NOT "busy" AND "category" = ${booking.category}`;
            const free =
              ready > 0 &&
              (await tx.ride.count({
                where: {
                  driverId: booking.driverId,
                  status: { in: ['accepted', 'arrived', 'started'] },
                },
              })) === 0;
            if (free) {
              await tx.ride.update({
                where: { id: booking.id },
                data: { status: 'accepted', acceptedAt: now, requestedAt: now },
              });
              assigned.push({ rideId: booking.id, driverId: booking.driverId });
              continue;
            }
            if (ready > 0) {
              await tx.$executeRaw`
                UPDATE driver_presence SET "busy" = false, "updatedAt" = now()
                WHERE "userId" = ${booking.driverId}::uuid`;
            }
            // The confirmed driver may still be on their way online (they
            // and the customer can call): keep waiting for them until close
            // to the time; this check repeats every tick.
            const waitUntil =
              (booking.scheduledAt?.getTime() ?? now.getTime()) -
              (booking.service === 'freight'
                ? this.settings.freightReservedWaitUntilMinutes
                : this.settings.rideReservedWaitUntilMinutes) *
                60_000;
            if (now.getTime() < waitUntil) continue;
            // Not available: the booking goes to everyone nearby instead.
            await tx.rideOffer.updateMany({
              where: { rideId: booking.id, driverId: booking.driverId },
              data: { status: 'declined', respondedAt: now },
            });
            released.push({ rideId: booking.id, driverId: booking.driverId });
          }
          await tx.ride.update({
            where: { id: booking.id },
            data: {
              driverId: null,
              vehicleId: null,
              fare: null,
              status: 'requested',
              requestedAt: now,
              nextExpandAt: new Date(
                now.getTime() + this.offerTtlSeconds(booking) * 1000,
              ),
            },
          });
          dispatchedRideIds.push(booking.id);
        }

        const due = await tx.ride.findMany({
          where: { status: 'requested', nextExpandAt: { lte: now } },
        });
        const last = this.settings.radiiMeters.length - 1;
        for (const ride of due) {
          // A negotiable ride already went out to everyone in range; re-run
          // the same broadcast (at the same radius) so a driver who just came
          // online still gets a chance, rather than shrinking back down to
          // the fixed-price widening steps.
          const radius =
            ride.service === 'freight'
              ? this.settings.freightRadiusMeters
              : ride.negotiable
                ? this.settings.negotiableRadiusMeters
                : this.settings.radiiMeters[
                    Math.min(ride.searchStep + 1, last)
                  ];
          const step = ride.negotiable
            ? ride.searchStep
            : Math.min(ride.searchStep + 1, last);
          await this.offerRide({ ...ride, searchRadiusMeters: radius });
          await tx.ride.update({
            where: { id: ride.id },
            data: {
              searchStep: step,
              searchRadiusMeters: radius,
              nextExpandAt: new Date(
                now.getTime() + this.offerTtlSeconds(ride) * 1000,
              ),
            },
          });
        }
        return {
          skipped: false,
          expired: expiredRideIds.length,
          widened: due.length,
        };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    for (const rideId of expiredRideIds)
      this.events.emit('ride.expired', { rideId });
    for (const { rideId, driverId } of assigned)
      this.events.emit('ride.accepted', { rideId, driverId });
    for (const { rideId, driverId } of released)
      this.events.emit('ride.reservation_released', { rideId, driverId });
    // Booked rides now looking for a driver: offer them like a new request.
    for (const rideId of dispatchedRideIds) {
      const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
      if (ride?.status !== 'requested') continue;
      await this.offerRide(ride);
      this.events.emit('ride.requested', {
        rideId,
        passengerId: ride.passengerId,
        category: ride.category,
      });
      this.events.emit('ride.dispatched', { rideId });
    }
    return result;
  }

  private async safeTick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Matching tick failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
