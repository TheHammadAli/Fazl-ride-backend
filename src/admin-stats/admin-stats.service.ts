import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_TZ_OFFSET_MINUTES,
  type Period,
  periodBounds,
  startOfBusinessDay,
} from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 86_400_000;
const ACTIVE = ['accepted', 'arrived', 'started'] as const;
// A position older than this is not shown as live.
const LIVE_SECONDS = 120;
// Counted as online on the dashboard (the sweeper's own limit, 5 minutes).
const ONLINE_SECONDS = Number(process.env.DRIVER_OFFLINE_AFTER_SECONDS ?? 300);
// Reports never cover more than this, so one request stays cheap.
const MAX_REPORT_DAYS = 366;

// Read-only numbers for the admin dashboard and reports, straight from the
// tables (reporting only: nothing here changes data).
@Injectable()
export class AdminStatsService {
  private readonly tz: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.tz = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  async dashboard(period: Period = 'today') {
    const now = new Date();
    const { from, to } = periodBounds(period, now, this.tz);
    // The same length of time just before, for "vs last ..." trends.
    const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    const [
      current,
      previous,
      requested,
      activeNow,
      waitingNow,
      upcomingBookings,
      users,
      newUsers,
      approvedDrivers,
      driverReviews,
      vehiclesPending,
      walletRequests,
      online,
      live,
    ] = await Promise.all([
      this.totals(from, to),
      this.totals(prevFrom, from),
      this.prisma.ride.count({
        where: { requestedAt: { gte: from, lte: to } },
      }),
      this.prisma.ride.count({ where: { status: { in: [...ACTIVE] } } }),
      this.prisma.ride.count({ where: { status: 'requested' } }),
      this.prisma.ride.count({
        where: { status: 'scheduled', scheduledAt: { gte: now } },
      }),
      this.prisma.user.count({ where: { status: { not: 'deleted' } } }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: from, lte: to },
          status: { not: 'deleted' },
        },
      }),
      this.prisma.driverProfile.count({ where: { status: 'approved' } }),
      this.prisma.driverProfile.count({
        where: { status: 'pending', submittedAt: { not: null } },
      }),
      this.prisma.vehicle.count({ where: { status: 'pending' } }),
      this.prisma.walletRequest.count({ where: { status: 'pending' } }),
      // Only drivers whose phone sent a position lately: a driver stuck
      // "online" on a ride that never ended does not count.
      this.prisma.$queryRaw<{ online: bigint; busy: bigint }[]>`
        SELECT count(*) FILTER (WHERE "isOnline") AS online,
               count(*) FILTER (WHERE "isOnline" AND busy) AS busy
        FROM driver_presence
        WHERE "locationUpdatedAt" > now() - make_interval(secs => ${ONLINE_SECONDS})`,
      this.live(),
    ]);
    const finished = current.completed + current.cancelled;
    return {
      period,
      from,
      to,
      rides: {
        requested,
        completed: current.completed,
        cancelled: current.cancelled,
        cancellationRate: finished ? current.cancelled / finished : 0,
        activeNow,
        waitingNow,
        upcomingBookings,
        previousCompleted: previous.completed,
      },
      revenue: {
        fares: current.fares,
        commission: current.commission,
        previousFares: previous.fares,
      },
      users: { total: users, new: newUsers },
      drivers: {
        approved: approvedDrivers,
        onlineNow: Number(online[0]?.online ?? 0),
        busyNow: Number(online[0]?.busy ?? 0),
      },
      pending: { driverReviews, vehicles: vehiclesPending, walletRequests },
      live,
    };
  }

  // Completed and cancelled rides, fares and commission in [from, to).
  private async totals(from: Date, to: Date) {
    const [done, cancelled] = await Promise.all([
      this.prisma.ride.aggregate({
        where: { status: 'completed', completedAt: { gte: from, lt: to } },
        _count: true,
        _sum: { fare: true, commission: true },
      }),
      this.prisma.ride.count({
        where: { status: 'cancelled', cancelledAt: { gte: from, lt: to } },
      }),
    ]);
    return {
      completed: done._count,
      cancelled,
      fares: done._sum.fare ?? 0,
      commission: done._sum.commission ?? 0,
    };
  }

  // What is happening right now, for the map: rides under way (with the
  // driver's last position) and online drivers.
  async live() {
    const [rides, drivers] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          status: string;
          category: string;
          service: string;
          pickupAddress: string;
          dropoffAddress: string;
          pickupLat: number;
          pickupLng: number;
          dropoffLat: number;
          dropoffLng: number;
          fare: number | null;
          offeredFare: number | null;
          estimatedFare: number;
          requestedAt: Date;
          passengerName: string | null;
          passengerPhone: string;
          driverId: string | null;
          driverName: string | null;
          driverPhone: string | null;
          driverLat: number | null;
          driverLng: number | null;
        }[]
      >`
        SELECT r.id, r.status, r.category, r.service, r."pickupAddress",
               r."dropoffAddress", r."pickupLat", r."pickupLng", r."dropoffLat",
               r."dropoffLng", r.fare, r."offeredFare", r."estimatedFare",
               r."requestedAt", p.name AS "passengerName",
               p.phone AS "passengerPhone", r."driverId",
               d.name AS "driverName", d.phone AS "driverPhone",
               ST_Y(dp.location::geometry) AS "driverLat",
               ST_X(dp.location::geometry) AS "driverLng"
        FROM rides r
        JOIN users p ON p.id = r."passengerId"
        LEFT JOIN users d ON d.id = r."driverId"
        LEFT JOIN driver_presence dp ON dp."userId" = r."driverId"
        WHERE r.status IN ('requested', 'accepted', 'arrived', 'started')
        ORDER BY r."requestedAt" DESC
        LIMIT 200`,
      this.prisma.$queryRaw<
        {
          userId: string;
          name: string | null;
          phone: string;
          lat: number;
          lng: number;
          category: string;
          busy: boolean;
        }[]
      >`
        SELECT dp."userId", u.name, u.phone,
               ST_Y(dp.location::geometry) AS lat, ST_X(dp.location::geometry) AS lng,
               dp.category, dp.busy
        FROM driver_presence dp
        JOIN users u ON u.id = dp."userId"
        WHERE dp."isOnline" AND dp.location IS NOT NULL
          AND dp."locationUpdatedAt" > now() - make_interval(secs => ${LIVE_SECONDS})
        LIMIT 1000`,
    ]);
    return {
      rides: rides.map((r) => ({
        id: r.id,
        status: r.status,
        category: r.category,
        service: r.service,
        fare: r.fare ?? r.offeredFare ?? r.estimatedFare,
        requestedAt: r.requestedAt,
        pickup: {
          lat: r.pickupLat,
          lng: r.pickupLng,
          address: r.pickupAddress,
        },
        dropoff: {
          lat: r.dropoffLat,
          lng: r.dropoffLng,
          address: r.dropoffAddress,
        },
        passenger: { name: r.passengerName, phone: r.passengerPhone },
        driver: r.driverId
          ? {
              id: r.driverId,
              name: r.driverName,
              phone: r.driverPhone,
              location:
                r.driverLat !== null && r.driverLng !== null
                  ? { lat: r.driverLat, lng: r.driverLng }
                  : null,
            }
          : null,
      })),
      drivers,
    };
  }

  async reports(fromDay?: string, toDay?: string) {
    const today = startOfBusinessDay(new Date(), this.tz);
    const to = toDay ? this.dayStart(toDay) : today;
    const from = fromDay
      ? this.dayStart(fromDay)
      : new Date(to.getTime() - 29 * DAY);
    if (from > to) throw new BadRequestException('"from" is after "to"');
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    if (days > MAX_REPORT_DAYS) {
      throw new BadRequestException(`At most ${MAX_REPORT_DAYS} days at once`);
    }
    const end = new Date(to.getTime() + DAY);
    const tz = this.tz;

    const [daily, byCategory, cancelledBy, payments, totals] =
      await Promise.all([
        this.prisma.$queryRaw<
          {
            day: Date;
            completed: bigint;
            cancelled: bigint;
            fares: bigint;
            commission: bigint;
          }[]
        >`
        SELECT date_trunc('day', COALESCE("completedAt", "cancelledAt") + make_interval(mins => ${tz})) AS day,
               count(*) FILTER (WHERE status = 'completed') AS completed,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               COALESCE(sum(fare) FILTER (WHERE status = 'completed'), 0) AS fares,
               COALESCE(sum(commission) FILTER (WHERE status = 'completed'), 0) AS commission
        FROM rides
        WHERE (status = 'completed' AND "completedAt" >= ${from} AND "completedAt" < ${end})
           OR (status = 'cancelled' AND "cancelledAt" >= ${from} AND "cancelledAt" < ${end})
        GROUP BY 1`,
        this.prisma.$queryRaw<
          {
            category: string;
            label: string | null;
            service: string;
            completed: bigint;
            fares: bigint;
          }[]
        >`
        SELECT r.category, c.label, r.service, count(*) AS completed,
               COALESCE(sum(r.fare), 0) AS fares
        FROM rides r
        LEFT JOIN vehicle_categories c ON c.key = r.category
        WHERE r.status = 'completed' AND r."completedAt" >= ${from} AND r."completedAt" < ${end}
        GROUP BY r.category, c.label, r.service
        ORDER BY completed DESC`,
        this.prisma.ride.groupBy({
          by: ['cancelledBy'],
          where: { status: 'cancelled', cancelledAt: { gte: from, lt: end } },
          _count: { _all: true },
        }),
        this.prisma.ride.aggregate({
          where: { status: 'completed', completedAt: { gte: from, lt: end } },
          _sum: { fare: true, walletPaid: true, commission: true },
          _count: true,
        }),
        this.prisma.ride.groupBy({
          by: ['tripType'],
          where: { status: 'completed', completedAt: { gte: from, lt: end } },
          _count: { _all: true },
        }),
      ]);

    // Every day in the range, also the empty ones.
    const byDay = new Map(
      daily.map((d) => [d.day.toISOString().slice(0, 10), d]),
    );
    const series = Array.from({ length: days }, (_, i) => {
      const local = new Date(from.getTime() + i * DAY + tz * 60_000);
      const key = local.toISOString().slice(0, 10);
      const d = byDay.get(key);
      return {
        day: key,
        completed: Number(d?.completed ?? 0),
        cancelled: Number(d?.cancelled ?? 0),
        fares: Number(d?.fares ?? 0),
        commission: Number(d?.commission ?? 0),
      };
    });
    const fares = payments._sum.fare ?? 0;
    const wallet = payments._sum.walletPaid ?? 0;
    return {
      from: series[0].day,
      to: series[series.length - 1].day,
      totals: {
        completed: payments._count,
        cancelled: series.reduce((s, d) => s + d.cancelled, 0),
        fares,
        commission: payments._sum.commission ?? 0,
      },
      daily: series,
      byCategory: byCategory.map((c) => ({
        category: c.category,
        label: c.label ?? c.category,
        service: c.service,
        completed: Number(c.completed),
        fares: Number(c.fares),
      })),
      byTripType: totals.map((t) => ({
        tripType: t.tripType,
        completed: t._count._all,
      })),
      cancelledBy: cancelledBy.map((c) => ({
        by: c.cancelledBy ?? 'system',
        count: c._count._all,
      })),
      payments: { cash: fares - wallet, wallet },
    };
  }

  // "2026-10-15" -> that day's start in business-local time.
  private dayStart(day: string) {
    const [y, m, d] = day.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - this.tz * 60_000);
  }
}
