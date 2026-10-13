import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subscription } from 'rxjs';
import { DEFAULT_TZ_OFFSET_MINUTES } from '../common/time.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { RideSchedule } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingSettingsService } from './booking-settings.service.js';
import type {
  CreateRideScheduleDto,
  UpdateRideScheduleDto,
} from './dto/ride-schedule.dto.js';
import { FaresService } from './fares.service.js';
import { RidesService } from './rides.service.js';
import {
  dueOccurrences,
  localDate,
  nextRun,
  parseTime,
} from './schedule-rules.js';

const pad = (n: number) => String(n).padStart(2, '0');
const timeText = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Frequent traveler: a trip that repeats on chosen days. Each day's booking
// is made a while ahead (scheduleAheadHours) and then follows the normal
// Ride Later flow: drivers offer, the customer confirms, the driver starts.
@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulesService.name);
  private readonly tzOffset: number;
  private subscription?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rides: RidesService,
    private readonly fares: FaresService,
    private readonly bookings: BookingSettingsService,
    private readonly events: DomainEvents,
    config: ConfigService,
  ) {
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  // The driver a customer confirmed is remembered, to hear first next time.
  onModuleInit() {
    this.subscription = this.events
      .on<{ rideId: string; driverId: string }>('ride.reservation_confirmed')
      .subscribe(({ payload }) => {
        void this.prisma.ride
          .findUnique({
            where: { id: payload.rideId },
            select: { scheduleId: true },
          })
          .then((ride) =>
            ride?.scheduleId
              ? this.prisma.rideSchedule.update({
                  where: { id: ride.scheduleId },
                  data: { lastDriverId: payload.driverId },
                })
              : null,
          )
          .catch(() => {});
      });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  async list(passengerId: string) {
    const schedules = await this.prisma.rideSchedule.findMany({
      where: { passengerId },
      include: {
        skips: true,
        rides: {
          where: { status: 'scheduled' },
          select: { id: true, scheduledAt: true, driverId: true },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { items: schedules.map((s) => this.present(s)) };
  }

  async create(passengerId: string, dto: CreateRideScheduleDto) {
    const s = await this.bookings.get();
    const count = await this.prisma.rideSchedule.count({
      where: { passengerId },
    });
    if (count >= s.maxSchedules) {
      throw new ConflictException(
        `You can keep up to ${s.maxSchedules} regular trips`,
      );
    }
    const timeMinutes = parseTime(dto.time);
    if (timeMinutes == null) throw new BadRequestException('Invalid time');
    // Checks the route and the vehicle type now, not on the first morning.
    await this.fares.quote(
      dto.pickup,
      dto.dropoff,
      dto.category,
      dto.tripType ?? 'within_city',
    );
    const created = await this.prisma.rideSchedule.create({
      data: {
        passengerId,
        name: dto.name?.trim() || null,
        pickupLat: dto.pickup.lat,
        pickupLng: dto.pickup.lng,
        pickupAddress: dto.pickup.address,
        dropoffLat: dto.dropoff.lat,
        dropoffLng: dto.dropoff.lng,
        dropoffAddress: dto.dropoff.address,
        category: dto.category,
        tripType: dto.tripType ?? 'within_city',
        days: [...dto.days].sort((a, b) => a - b),
        timeMinutes,
        offeredFare: dto.offeredFare,
        paymentMethod: dto.paymentMethod ?? 'cash',
      },
    });
    // Tomorrow's booking may already be due.
    await this.createDueFor(created).catch(() => {});
    return this.get(passengerId, created.id);
  }

  async update(passengerId: string, id: string, dto: UpdateRideScheduleDto) {
    await this.own(passengerId, id);
    const timeMinutes =
      dto.time != null ? (parseTime(dto.time) ?? undefined) : undefined;
    const updated = await this.prisma.rideSchedule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() || null }),
        ...(dto.days && { days: [...dto.days].sort((a, b) => a - b) }),
        ...(timeMinutes !== undefined && { timeMinutes }),
        ...(dto.offeredFare !== undefined && { offeredFare: dto.offeredFare }),
        ...(dto.paymentMethod && { paymentMethod: dto.paymentMethod }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
    if (updated.active) await this.createDueFor(updated).catch(() => {});
    return this.get(passengerId, id);
  }

  // Deleting a regular trip also drops its bookings nobody confirmed yet.
  async remove(passengerId: string, id: string) {
    await this.own(passengerId, id);
    const open = await this.prisma.ride.findMany({
      where: { scheduleId: id, status: 'scheduled', driverId: null },
      select: { id: true },
    });
    for (const ride of open) {
      await this.rides.cancel(passengerId, ride.id, {}).catch(() => {});
    }
    await this.prisma.rideSchedule.delete({ where: { id } });
    return { message: 'Regular trip deleted' };
  }

  // A day off (holiday): no booking that day; one already made is cancelled.
  async skip(passengerId: string, id: string, date: string) {
    await this.own(passengerId, id);
    await this.prisma.rideScheduleSkip.upsert({
      where: { scheduleId_date: { scheduleId: id, date } },
      create: { scheduleId: id, date },
      update: {},
    });
    const made = await this.prisma.ride.findMany({
      where: { scheduleId: id, status: 'scheduled' },
      select: { id: true, scheduledAt: true },
    });
    for (const ride of made) {
      if (
        ride.scheduledAt &&
        localDate(ride.scheduledAt, this.tzOffset) === date
      ) {
        await this.rides.cancel(passengerId, ride.id, {}).catch(() => {});
        // Detached, so un-skipping the day can book it again.
        await this.prisma.ride.update({
          where: { id: ride.id },
          data: { scheduleId: null },
        });
      }
    }
    return this.get(passengerId, id);
  }

  async unskip(passengerId: string, id: string, date: string) {
    await this.own(passengerId, id);
    await this.prisma.rideScheduleSkip.deleteMany({
      where: { scheduleId: id, date },
    });
    const schedule = await this.prisma.rideSchedule.findUnique({
      where: { id },
    });
    if (schedule?.active) await this.createDueFor(schedule).catch(() => {});
    return this.get(passengerId, id);
  }

  // Run by the booking sweeper: makes each active schedule's due bookings.
  async createDue(now = new Date()) {
    const schedules = await this.prisma.rideSchedule.findMany({
      where: { active: true },
    });
    let made = 0;
    for (const schedule of schedules) {
      made += await this.createDueFor(schedule, now).catch((error) => {
        this.logger.warn(
          `Schedule ${schedule.id} could not book: ${String(error?.message ?? error)}`,
        );
        return 0;
      });
    }
    return made;
  }

  private async createDueFor(schedule: RideSchedule, now = new Date()) {
    if (!schedule.active) return 0;
    const s = await this.bookings.get();
    const skips = await this.prisma.rideScheduleSkip.findMany({
      where: { scheduleId: schedule.id },
      select: { date: true },
    });
    const due = dueOccurrences(schedule, now, {
      tzOffsetMinutes: this.tzOffset,
      aheadHours: s.scheduleAheadHours,
      minAheadMinutes: s.minAheadMinutes,
      skipped: new Set(skips.map((k) => k.date)),
    });
    let made = 0;
    for (const run of due) {
      const exists = await this.prisma.ride.count({
        where: { scheduleId: schedule.id, scheduledAt: run.at },
      });
      if (exists) continue;
      await this.rides.request(
        schedule.passengerId,
        {
          pickup: {
            lat: schedule.pickupLat,
            lng: schedule.pickupLng,
            address: schedule.pickupAddress,
          },
          dropoff: {
            lat: schedule.dropoffLat,
            lng: schedule.dropoffLng,
            address: schedule.dropoffAddress,
          },
          category: schedule.category,
          tripType: schedule.tripType,
          offeredFare: schedule.offeredFare ?? undefined,
          paymentMethod: schedule.paymentMethod,
          scheduledAt: run.at.toISOString(),
        },
        { scheduleId: schedule.id },
      );
      made++;
    }
    return made;
  }

  private async get(passengerId: string, id: string) {
    const schedule = await this.prisma.rideSchedule.findFirst({
      where: { id, passengerId },
      include: {
        skips: true,
        rides: {
          where: { status: 'scheduled' },
          select: { id: true, scheduledAt: true, driverId: true },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!schedule) throw new NotFoundException('Regular trip not found');
    return this.present(schedule);
  }

  private async own(passengerId: string, id: string) {
    const found = await this.prisma.rideSchedule.count({
      where: { id, passengerId },
    });
    if (!found) throw new NotFoundException('Regular trip not found');
  }

  private present(
    s: RideSchedule & {
      skips: { date: string }[];
      rides: {
        id: string;
        scheduledAt: Date | null;
        driverId: string | null;
      }[];
    },
  ) {
    const today = localDate(new Date(), this.tzOffset);
    const skipped = s.skips.map((k) => k.date).filter((d) => d >= today);
    return {
      id: s.id,
      name: s.name,
      pickup: { lat: s.pickupLat, lng: s.pickupLng, address: s.pickupAddress },
      dropoff: {
        lat: s.dropoffLat,
        lng: s.dropoffLng,
        address: s.dropoffAddress,
      },
      category: s.category,
      tripType: s.tripType,
      days: s.days,
      time: timeText(s.timeMinutes),
      offeredFare: s.offeredFare,
      paymentMethod: s.paymentMethod,
      active: s.active,
      skippedDates: skipped.sort(),
      nextRunAt: s.active
        ? nextRun(s, new Date(), this.tzOffset, new Set(skipped))
        : null,
      // The booking already made for the next run, if any.
      nextBooking: s.rides[0]
        ? {
            rideId: s.rides[0].id,
            scheduledAt: s.rides[0].scheduledAt,
            driverConfirmed: s.rides[0].driverId != null,
          }
        : null,
    };
  }
}
