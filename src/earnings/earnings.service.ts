import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import {
  DEFAULT_TZ_OFFSET_MINUTES,
  Period,
  periodBounds,
} from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PresenceService } from '../presence/presence.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const LABELS = {
  ride_fare: 'Ride Fare',
  adjustment: 'Adjustment',
  cashout: 'Cashout',
} as const;
// Cashouts exist in the ledger design but are hidden until wallets / online payments do.
const VISIBLE = ['ride_fare', 'adjustment'] as const;

@Injectable()
export class EarningsService {
  private readonly tzOffset: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    config: ConfigService,
  ) {
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  // Called inside the ride-completion transaction so a fare and its earning
  // entry are saved together or not at all. Safe to call twice for one ride.
  recordRideFare(
    tx: Prisma.TransactionClient,
    input: { driverId: string; rideId: string; amount: number },
  ) {
    return tx.driverEarning.createMany({
      data: [
        {
          driverId: input.driverId,
          rideId: input.rideId,
          type: 'ride_fare',
          amount: input.amount,
        },
      ],
      skipDuplicates: true,
    });
  }

  // Total, rides driven and time online for Today / This week / This month.
  async summary(driverId: string, period: Period, now = new Date()) {
    const { from, to } = periodBounds(period, now, this.tzOffset);
    const range = { gte: from, lte: to };
    const [sum, rides, onlineSeconds, recent] = await Promise.all([
      this.prisma.driverEarning.aggregate({
        where: { driverId, type: { in: [...VISIBLE] }, createdAt: range },
        _sum: { amount: true },
      }),
      this.prisma.driverEarning.count({
        where: { driverId, type: 'ride_fare', createdAt: range },
      }),
      this.presence.onlineSecondsBetween(driverId, from, now),
      this.transactions(driverId, { limit: 10 }),
    ]);
    return {
      period,
      from,
      to,
      currency: 'PKR',
      total: sum._sum.amount ?? 0,
      rides,
      onlineSeconds,
      recentTransactions: recent.items,
    };
  }

  // The dashboard's tiles: are you online, today's rides and earnings, online hours.
  async dashboard(driverId: string, now = new Date()) {
    const [status, today] = await Promise.all([
      this.presence.status(driverId),
      this.summary(driverId, 'today', now),
    ]);
    return {
      online: status.online,
      busy: status.busy,
      currency: 'PKR',
      todayRides: today.rides,
      todayEarnings: today.total,
      onlineSecondsToday: today.onlineSeconds,
    };
  }

  async transactions(
    driverId: string,
    opts: { limit: number; cursor?: string },
  ) {
    const before = decodeCursor(opts.cursor);
    const where: Prisma.DriverEarningWhereInput = {
      driverId,
      type: { in: [...VISIBLE] },
      ...(before && {
        OR: [
          { createdAt: { lt: before.at } },
          { createdAt: before.at, id: { lt: before.id } },
        ],
      }),
    };
    const rows = await this.prisma.driverEarning.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((e) => ({
        id: e.id,
        type: e.type,
        label: LABELS[e.type],
        amount: e.amount,
        rideId: e.rideId,
        createdAt: e.createdAt,
      })),
      nextCursor:
        rows.length > opts.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
