import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AdminRidesService } from './admin-rides.service.js';
import { RideSettings } from './rides.settings.js';
import {
  DEFAULT_STALE_LIMITS,
  type StaleLimits,
  staleReason,
} from './stale-rides.js';

const SWEEPER_LOCK_ID = 727_004;
const TICK_MS = 60_000;

// Closes rides under way that nobody is on any more (see stale-rides.ts):
// the driver is freed, both people and the admins are told. Without it a
// driver whose phone died stays "busy" and the passenger can not book again.
@Injectable()
export class StaleRideSweeperService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(StaleRideSweeperService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly limits: StaleLimits;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminRides: AdminRidesService,
    private readonly rideSettings: RideSettings,
    config: ConfigService,
  ) {
    const num = (key: string, fallback: number) => {
      const value = Number(config.get(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    this.limits = {
      driverMinutes: num(
        'STALE_DRIVER_MINUTES',
        DEFAULT_STALE_LIMITS.driverMinutes,
      ),
      tripMinutes: num('STALE_TRIP_MINUTES', DEFAULT_STALE_LIMITS.tripMinutes),
      maxHours: num('STALE_RIDE_HOURS', DEFAULT_STALE_LIMITS.maxHours),
    };
  }

  onApplicationBootstrap() {
    if (!this.rideSettings.sweeperEnabled) return;
    this.timer = setInterval(() => void this.safeSweep(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeSweep() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(`Stale ride sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Closes every stale ride; returns how many. */
  async sweep(now = new Date()) {
    // One instance at a time; the lock is held only while picking.
    const candidates = await this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${SWEEPER_LOCK_ID}::bigint) AS locked`;
      if (!locked) return [];
      return tx.$queryRaw<
        {
          id: string;
          status: string;
          requestedAt: Date;
          acceptedAt: Date | null;
          startedAt: Date | null;
          driverSeenAt: Date | null;
        }[]
      >`
        SELECT r.id, r.status, r."requestedAt", r."acceptedAt", r."startedAt",
               dp."locationUpdatedAt" AS "driverSeenAt"
        FROM rides r
        LEFT JOIN driver_presence dp ON dp."userId" = r."driverId"
        WHERE r.status IN ('accepted', 'arrived', 'started', 'requested')
        LIMIT 500`;
    });
    let closed = 0;
    for (const ride of candidates) {
      if (!staleReason(ride, now, this.limits)) continue;
      try {
        if (await this.adminRides.closeStale(ride.id, now, this.limits)) {
          closed++;
        }
      } catch (error) {
        this.logger.warn(`Could not close ride ${ride.id}: ${String(error)}`);
      }
    }
    if (closed) this.logger.log(`Closed ${closed} stale ride(s)`);
    return closed;
  }
}
