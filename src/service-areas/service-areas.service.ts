import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import {
  DEFAULT_TZ_OFFSET_MINUTES,
  startOfBusinessDay,
} from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cityFor, type LatLng } from './service-area-rules.js';
import type {
  CreateServiceCityDto,
  UpdateServiceCityDto,
} from './service-areas.dto.js';

const SETTINGS_ROW = 1;

// How long the active cities are cached for the ride-request check.
const CACHE_MS = 30_000;

// Rides that still count as "under way" for a city's numbers.
const UNDER_WAY = ['requested', 'accepted', 'arrived', 'started'];

type CityRow = Awaited<
  ReturnType<PrismaService['serviceCity']['findMany']>
>[number];

// Countries & Cities: where FAZL operates, the numbers per city, and the
// optional rule that rides start only inside an active city.
@Injectable()
export class ServiceAreasService {
  private cache: { at: number; cities: CityRow[]; only: boolean } | null = null;
  private readonly tz: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.tz = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  private async onlyServiceCities() {
    const s = await this.prisma.appSettings.upsert({
      where: { id: SETTINGS_ROW },
      create: { id: SETTINGS_ROW },
      update: {},
      select: { onlyServiceCities: true },
    });
    return s.onlyServiceCities;
  }

  // Every city with its live numbers, for the admin page.
  async list() {
    const [cities, only] = await Promise.all([
      this.prisma.serviceCity.findMany({
        orderBy: [{ country: 'asc' }, { name: 'asc' }],
      }),
      this.onlyServiceCities(),
    ]);
    const items = await Promise.all(
      cities.map(async (c) => ({ ...c, stats: await this.stats(c) })),
    );
    return { items, onlyServiceCities: only };
  }

  // Online drivers seen in the last 2 minutes, rides under way and rides
  // requested today (business day) with the pickup inside the circle.
  private async stats(city: CityRow) {
    const meters = city.radiusKm * 1000;
    const today = startOfBusinessDay(new Date(), this.tz);
    const [[drivers], [rides]] = await Promise.all([
      this.prisma.$queryRaw<{ online: number }[]>`
        SELECT count(*)::int AS online FROM driver_presence
        WHERE "isOnline" AND "location" IS NOT NULL
          AND "locationUpdatedAt" > now() - interval '2 minutes'
          AND ST_DWithin("location",
            ST_SetSRID(ST_MakePoint(${city.lng}::float8, ${city.lat}::float8), 4326)::geography,
            ${meters}::float8)`,
      this.prisma.$queryRaw<
        { active: number; today: number; completed: number }[]
      >`
        SELECT
          count(*) FILTER (WHERE "status"::text = ANY(${UNDER_WAY}))::int AS active,
          count(*) FILTER (WHERE "requestedAt" >= ${today})::int AS today,
          count(*) FILTER (WHERE "requestedAt" >= ${today} AND "status" = 'completed')::int AS completed
        FROM rides
        WHERE ("status"::text = ANY(${UNDER_WAY}) OR "requestedAt" >= ${today})
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint("pickupLng", "pickupLat"), 4326)::geography,
            ST_SetSRID(ST_MakePoint(${city.lng}::float8, ${city.lat}::float8), 4326)::geography,
            ${meters}::float8)`,
    ]);
    return {
      onlineDrivers: drivers.online,
      activeRides: rides.active,
      ridesToday: rides.today,
      completedToday: rides.completed,
    };
  }

  async create(adminId: string, dto: CreateServiceCityDto) {
    const country = dto.country?.trim() || 'Pakistan';
    const name = dto.name.trim();
    await this.assertNameFree(name, country);
    const city = await this.prisma.serviceCity.create({
      data: {
        name,
        country,
        lat: dto.lat,
        lng: dto.lng,
        radiusKm: dto.radiusKm,
        active: dto.active,
      },
    });
    this.cache = null;
    await this.audit.log(
      adminId,
      'service_city.create',
      'service_city',
      city.id,
      {
        name,
        country,
        radiusKm: city.radiusKm,
      },
    );
    return city;
  }

  async update(adminId: string, id: string, dto: UpdateServiceCityDto) {
    const current = await this.prisma.serviceCity.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('City not found');
    const name = dto.name?.trim() ?? current.name;
    const country = dto.country?.trim() ?? current.country;
    if (name !== current.name || country !== current.country) {
      await this.assertNameFree(name, country);
    }
    if (dto.active === false && current.active) {
      await this.assertNotLastWhileRuleOn(id);
    }
    const city = await this.prisma.serviceCity.update({
      where: { id },
      data: { ...this.clean(dto), name, country },
    });
    this.cache = null;
    await this.audit.log(
      adminId,
      'service_city.update',
      'service_city',
      id,
      JSON.parse(JSON.stringify(dto)),
    );
    return city;
  }

  async remove(adminId: string, id: string) {
    const current = await this.prisma.serviceCity.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('City not found');
    if (current.active) await this.assertNotLastWhileRuleOn(id);
    await this.prisma.serviceCity.delete({ where: { id } });
    this.cache = null;
    await this.audit.log(adminId, 'service_city.delete', 'service_city', id, {
      name: current.name,
      country: current.country,
    });
    return { deleted: true };
  }

  // Turning the rule on with no active city would stop every ride.
  async setRule(adminId: string, onlyServiceCities: boolean) {
    if (onlyServiceCities) {
      const active = await this.prisma.serviceCity.count({
        where: { active: true },
      });
      if (active === 0) {
        throw new BadRequestException(
          'Add at least one active city before limiting rides to cities',
        );
      }
    }
    await this.prisma.appSettings.upsert({
      where: { id: SETTINGS_ROW },
      create: { id: SETTINGS_ROW, onlyServiceCities },
      update: { onlyServiceCities },
    });
    this.cache = null;
    await this.audit.log(
      adminId,
      'service_area.rule',
      'app_settings',
      String(SETTINGS_ROW),
      { onlyServiceCities },
    );
    return { onlyServiceCities };
  }

  // Called before a ride or booking is created. Does nothing while the rule
  // is off (the default).
  async assertServed(pickup: LatLng) {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const [cities, only] = await Promise.all([
        this.prisma.serviceCity.findMany({ where: { active: true } }),
        this.onlyServiceCities(),
      ]);
      this.cache = { at: Date.now(), cities, only };
    }
    if (!this.cache.only) return;
    if (!cityFor(pickup, this.cache.cities)) {
      throw new BadRequestException({
        code: 'SERVICE_AREA',
        message: 'FAZL is not available at this pickup yet',
        cities: this.cache.cities.map((c) => c.name),
      });
    }
  }

  private clean(dto: CreateServiceCityDto | UpdateServiceCityDto) {
    return {
      lat: dto.lat,
      lng: dto.lng,
      radiusKm: dto.radiusKm,
      active: dto.active,
    };
  }

  private async assertNameFree(name: string, country: string) {
    const clash = await this.prisma.serviceCity.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        country: { equals: country, mode: 'insensitive' },
      },
    });
    if (clash) throw new ConflictException(`${name} is already in the list`);
  }

  private async assertNotLastWhileRuleOn(id: string) {
    if (!(await this.onlyServiceCities())) return;
    const others = await this.prisma.serviceCity.count({
      where: { active: true, id: { not: id } },
    });
    if (others === 0) {
      throw new BadRequestException(
        'This is the last active city while rides are limited to cities. Turn that rule off first',
      );
    }
  }
}
