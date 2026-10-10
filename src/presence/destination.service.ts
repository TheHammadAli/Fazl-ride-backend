import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { haversineMeters, type LatLng } from '../common/geo.js';
import {
  DEFAULT_TZ_OFFSET_MINUTES,
  startOfBusinessDay,
} from '../common/time.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Destination mode ("Go Home" / Uber destination filter): a driver heading
// somewhere (home, back to their city) only gets rides that take them that
// way (see destination-rule.ts, applied in MatchingService). A few uses per
// business day, each for a few hours, and it switches off on arrival, so it
// can not be kept on to cherry-pick long rides.
@Injectable()
export class DestinationService {
  private readonly usesPerDay: number;
  private readonly hours: number;
  private readonly arrivedMeters: number;
  private readonly tzOffset: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    config: ConfigService,
  ) {
    this.usesPerDay = Number(config.get('DESTINATION_USES_PER_DAY') ?? 2);
    this.hours = Number(config.get('DESTINATION_HOURS') ?? 3);
    this.arrivedMeters = Number(
      config.get('DESTINATION_ARRIVED_METERS') ?? 2_000,
    );
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  private usedToday(row: { usesDay: Date | null; usesCount: number } | null) {
    if (!row?.usesDay) return 0;
    const today = startOfBusinessDay(new Date(), this.tzOffset);
    return row.usesDay.getTime() === today.getTime() ? row.usesCount : 0;
  }

  private isOn(row: { active: boolean; expiresAt: Date | null } | null) {
    return !!row?.active && !!row.expiresAt && row.expiresAt > new Date();
  }

  // The driver's destination (null when off), and uses left today.
  async get(userId: string) {
    const row = await this.prisma.driverDestination.findUnique({
      where: { userId },
    });
    return {
      destination: this.isOn(row)
        ? {
            lat: row!.lat,
            lng: row!.lng,
            address: row!.address,
            expiresAt: row!.expiresAt,
          }
        : null,
      // The last place used, to offer it again ("Home").
      lastPlace: row
        ? { lat: row.lat, lng: row.lng, address: row.address }
        : null,
      usesLeftToday: Math.max(0, this.usesPerDay - this.usedToday(row)),
      usesPerDay: this.usesPerDay,
      hours: this.hours,
    };
  }

  // Turns destination mode on (a use), or moves the place while it is on
  // (not a new use).
  async set(userId: string, place: LatLng & { address: string }) {
    const row = await this.prisma.driverDestination.findUnique({
      where: { userId },
    });
    const now = new Date();
    const alreadyOn = this.isOn(row);
    const used = this.usedToday(row);
    if (!alreadyOn && used >= this.usesPerDay) {
      throw new ConflictException(
        `Destination mode can be used ${this.usesPerDay} times a day. Try again tomorrow.`,
      );
    }
    const data = {
      lat: place.lat,
      lng: place.lng,
      address: place.address,
      active: true,
      ...(!alreadyOn && {
        expiresAt: new Date(now.getTime() + this.hours * 60 * 60_000),
        usesDay: startOfBusinessDay(now, this.tzOffset),
        usesCount: used + 1,
      }),
    };
    await this.prisma.driverDestination.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.get(userId);
  }

  async clear(userId: string) {
    await this.prisma.driverDestination.updateMany({
      where: { userId, active: true },
      data: { active: false },
    });
    return this.get(userId);
  }

  // From each position update: arrived near the destination switches it off.
  async checkArrival(userId: string, at: LatLng) {
    const row = await this.prisma.driverDestination.findUnique({
      where: { userId },
    });
    if (!this.isOn(row)) return;
    if (haversineMeters(at, row!) > this.arrivedMeters) return;
    await this.clear(userId);
    this.events.emit('driver.destination_reached', {
      userId,
      address: row!.address,
    });
  }

  // Destinations that are on, for these drivers (matching filters by them).
  async activeFor(userIds: string[]): Promise<Map<string, LatLng>> {
    if (!userIds.length) return new Map();
    const rows = await this.prisma.driverDestination.findMany({
      where: {
        userId: { in: userIds },
        active: true,
        expiresAt: { gt: new Date() },
      },
      select: { userId: true, lat: true, lng: true },
    });
    return new Map(rows.map((r) => [r.userId, { lat: r.lat, lng: r.lng }]));
  }
}
