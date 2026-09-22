import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.service.js';
import { VehicleCategory } from '../generated/prisma/enums.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { RideSettings } from './rides.settings.js';

// Only one app instance runs a tick at a time (Postgres advisory lock), so the
// sweeper stays correct if the API is scaled to several instances.
const SWEEPER_LOCK_ID = 727_001;

export interface OfferableRide {
  id: string;
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  category: VehicleCategory;
  searchRadiusMeters: number;
  // Bidding rides broadcast to everyone in range instead of a handful of the
  // nearest drivers; see RideSettings.negotiableOffersLimit.
  negotiable?: boolean;
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
  ) {}

  onApplicationBootstrap() {
    if (!this.settings.sweeperEnabled) return;
    this.timer = setInterval(() => void this.safeTick(), this.settings.tickMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Offers the ride to the nearest available drivers of its category that have
  // not been asked yet. Returns how many new offers were created.
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
    const chosen = nearby
      .filter((d) => !skip.has(d.userId))
      .slice(0, perRound);
    if (!chosen.length) return 0;

    const expiresAt = new Date(
      Date.now() + this.settings.offerTtlSeconds * 1000,
    );
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

  // Expires stale requests and offers, and widens the search for rides nobody took yet.
  async tick(now = new Date()) {
    const expiredRideIds: string[] = [];
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

        const due = await tx.ride.findMany({
          where: { status: 'requested', nextExpandAt: { lte: now } },
        });
        const last = this.settings.radiiMeters.length - 1;
        for (const ride of due) {
          // A negotiable ride already went out to everyone in range; re-run
          // the same broadcast (at the same radius) so a driver who just came
          // online still gets a chance, rather than shrinking back down to
          // the fixed-price widening steps.
          const radius = ride.negotiable
            ? this.settings.negotiableRadiusMeters
            : this.settings.radiiMeters[Math.min(ride.searchStep + 1, last)];
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
                now.getTime() + this.settings.offerTtlSeconds * 1000,
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
