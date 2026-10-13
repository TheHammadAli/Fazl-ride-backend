import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CancellationsService } from '../cancellations/cancellations.service.js';
import { DEFAULT_TZ_OFFSET_MINUTES } from '../common/time.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  bookingKind,
  dueReminders,
  reminderTimes,
  startWindow,
} from './booking-rules.js';
import { BookingSettingsService } from './booking-settings.service.js';
import { RideSettings } from './rides.settings.js';
import { BOOKING_STRIKE } from './reservations.service.js';
import { SchedulesService } from './schedules.service.js';

const SWEEPER_LOCK_ID = 727_003;
const TICK_MS = 30_000;

// Looks after bookings for later. It never hands a booking to a driver on
// its own (the confirmed driver starts it): it closes bookings nobody took
// at their time, marks a confirmed driver who never started as a no-show,
// and sends the reminders and warnings, each once.
@Injectable()
export class BookingSweeperService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BookingSweeperService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly tzOffset: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingSettingsService,
    private readonly cancellations: CancellationsService,
    private readonly events: DomainEvents,
    private readonly rideSettings: RideSettings,
    private readonly schedules: SchedulesService,
    config: ConfigService,
  ) {
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
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
      this.logger.warn(`Booking sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async sweep(now = new Date()) {
    const s = await this.bookings.get();
    const expired: string[] = [];
    const missed: { rideId: string; driverId: string; passengerId: string }[] =
      [];
    const reminders: { rideId: string; kind: string }[] = [];

    const result = await this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SWEEPER_LOCK_ID}::bigint) AS locked`;
        if (!locked) return { skipped: true };

        // Nobody confirmed by the booked time: the booking closes.
        const unclaimed = await tx.ride.findMany({
          where: {
            status: 'scheduled',
            driverId: null,
            scheduledAt: { lte: now },
          },
          select: { id: true },
        });
        if (unclaimed.length) {
          const ids = unclaimed.map((r) => r.id);
          await tx.ride.updateMany({
            where: { id: { in: ids }, status: 'scheduled', driverId: null },
            data: {
              status: 'expired',
              cancelledBy: 'system',
              cancelledFromStatus: 'scheduled',
              cancelReason: 'No driver took this booking',
              cancelledAt: now,
            },
          });
          await tx.rideOffer.updateMany({
            where: { rideId: { in: ids }, status: { in: ['pending', 'bid'] } },
            data: { status: 'expired', respondedAt: now },
          });
          expired.push(...ids);
        }

        // Open bookings: reminders, and confirmed ones never started.
        const open = await tx.ride.findMany({
          where: {
            status: 'scheduled',
            scheduledAt: { lte: new Date(now.getTime() + 36 * 3_600_000) },
          },
          select: {
            id: true,
            passengerId: true,
            driverId: true,
            service: true,
            tripType: true,
            scheduledAt: true,
            requestedAt: true,
            reminders: { select: { kind: true } },
            offers: {
              where: { status: 'accepted' },
              select: { respondedAt: true },
              take: 1,
            },
          },
        });
        for (const b of open) {
          if (!b.scheduledAt) continue;
          const kind = bookingKind(b.service, b.tripType);
          if (b.driverId && now > startWindow(b.scheduledAt, kind, s).until) {
            await tx.ride.update({
              where: { id: b.id },
              data: {
                status: 'cancelled',
                cancelledBy: 'driver',
                cancelledFromStatus: 'scheduled',
                cancelReason: 'The driver did not start the booking',
                cancelledAt: now,
                noShow: true,
              },
            });
            await this.cancellations.record(tx, {
              rideId: b.id,
              userId: b.driverId,
              role: 'driver',
              fromStatus: 'scheduled',
              reason: `${BOOKING_STRIKE} no-show`,
            });
            missed.push({
              rideId: b.id,
              driverId: b.driverId,
              passengerId: b.passengerId,
            });
            continue;
          }
          const confirmed = b.driverId != null;
          // Reminders that were already past when the booking was made (or
          // the driver confirmed) are not sent late.
          const since = confirmed
            ? (b.offers[0]?.respondedAt ?? b.requestedAt)
            : b.requestedAt;
          const due = dueReminders(
            reminderTimes(
              { scheduledAt: b.scheduledAt, confirmed, kind },
              s,
              this.tzOffset,
            ),
            since,
            now,
            new Set(b.reminders.map((r) => r.kind)),
          );
          for (const reminder of due) {
            const created = await tx.bookingReminder.createMany({
              data: [{ rideId: b.id, kind: reminder }],
              skipDuplicates: true,
            });
            if (created.count) reminders.push({ rideId: b.id, kind: reminder });
          }
        }
        return { skipped: false };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );

    for (const rideId of expired) this.events.emit('ride.expired', { rideId });
    for (const m of missed) this.events.emit('booking.missed', m);
    for (const r of reminders) this.events.emit('booking.reminder', r);
    // Frequent traveler: each regular trip's next bookings. Safe on several
    // instances: a booking is unique per schedule and time.
    const scheduled = result.skipped ? 0 : await this.schedules.createDue(now);
    return { ...result, expired, missed, reminders, scheduled };
  }
}
