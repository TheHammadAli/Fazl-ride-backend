import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Only one app instance sweeps at a time (Postgres advisory lock).
const SWEEPER_LOCK_ID = 727_002;
const DEFAULT_OFFLINE_AFTER_SECONDS = 300;
const DEFAULT_TICK_MS = 30_000;

// Drivers who close the app, lose their network or run out of battery never press
// "Offline". After a while without any sign of life they are put offline here, so
// counts are right and their online time stops where it really stopped.
//
// Two timeouts work together: after 60 s a position no longer counts as "nearby"
// (passengers stop being offered to them at once), and after this longer one the
// driver is officially offline. The gap keeps a short tunnel or lift from kicking
// a driver out.
@Injectable()
export class PresenceSweeperService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PresenceSweeperService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  readonly offlineAfterMs: number;
  private readonly tickMs: number;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    config: ConfigService,
  ) {
    this.offlineAfterMs =
      Number(
        config.get('DRIVER_OFFLINE_AFTER_SECONDS') ??
          DEFAULT_OFFLINE_AFTER_SECONDS,
      ) * 1000;
    this.tickMs = Number(config.get('PRESENCE_TICK_MS') ?? DEFAULT_TICK_MS);
    this.enabled = String(config.get('PRESENCE_SWEEPER') ?? 'on') !== 'off';
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.safeSweep(), this.tickMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Puts every idle online driver offline. A driver on a ride is left alone: the
  // ride is still running, and the passenger can cancel it if the driver is gone.
  async sweep(now = new Date()) {
    const cutoff = new Date(now.getTime() - this.offlineAfterMs);
    const swept = await this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SWEEPER_LOCK_ID}::bigint) AS locked`;
        if (!locked) return null;

        // The condition is re-checked on the row itself, so a position that
        // arrives at this very moment wins and the driver stays online.
        const gone = await tx.$queryRaw<{ userId: string; lastSeenAt: Date }[]>`
          UPDATE driver_presence
          SET "isOnline" = false, "onlineSince" = NULL, "updatedAt" = now()
          WHERE "isOnline" AND NOT "busy"
            AND COALESCE("locationUpdatedAt", "onlineSince", "updatedAt") < ${cutoff}::timestamptz
          RETURNING "userId", COALESCE("locationUpdatedAt", "onlineSince", "updatedAt") AS "lastSeenAt"`;

        for (const driver of gone) {
          // The online session ends when the driver was last seen, not now.
          await tx.$executeRaw`
            UPDATE driver_sessions
            SET "endedAt" = GREATEST("startedAt", ${driver.lastSeenAt}::timestamptz)
            WHERE "userId" = ${driver.userId}::uuid AND "endedAt" IS NULL`;
        }
        return gone;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );

    for (const driver of swept ?? []) {
      this.events.emit('driver.offline', {
        userId: driver.userId,
        reason: 'inactive',
        lastSeenAt: driver.lastSeenAt,
      });
    }
    return { skipped: swept === null, wentOffline: swept?.length ?? 0 };
  }

  private async safeSweep() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.sweep();
      if (result.wentOffline)
        this.logger.log(`Put ${result.wentOffline} idle driver(s) offline`);
    } catch (error) {
      this.logger.warn(`Presence sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
