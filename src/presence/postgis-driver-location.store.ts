import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LatLng } from '../common/geo.js';
import { VehicleCategory } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DriverLocationStore,
  NearbyDriver,
  NearbyQuery,
} from './driver-location.store.js';

// A position older than this no longer counts as "available nearby".
export const DEFAULT_LOCATION_TTL_SECONDS = 60;

@Injectable()
export class PostgisDriverLocationStore extends DriverLocationStore {
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    this.ttlSeconds = Number(
      config.get('DRIVER_LOCATION_TTL_SECONDS') ?? DEFAULT_LOCATION_TTL_SECONDS,
    );
  }

  // PostGIS points are (longitude, latitude), the reverse of how people say it.
  async goOnline(
    userId: string,
    vehicleId: string,
    category: VehicleCategory,
    at: LatLng,
  ) {
    await this.prisma.$executeRaw`
      INSERT INTO driver_presence
        ("userId", "vehicleId", "category", "isOnline", "busy", "location",
         "locationUpdatedAt", "onlineSince", "updatedAt")
      VALUES
        (${userId}::uuid, ${vehicleId}::uuid, ${category}::"VehicleCategory", true, false,
         ST_SetSRID(ST_MakePoint(${at.lng}::float8, ${at.lat}::float8), 4326)::geography,
         now(), now(), now())
      ON CONFLICT ("userId") DO UPDATE SET
        "vehicleId" = EXCLUDED."vehicleId",
        "category" = EXCLUDED."category",
        "location" = EXCLUDED."location",
        "locationUpdatedAt" = now(),
        "onlineSince" = CASE WHEN driver_presence."isOnline"
                             THEN driver_presence."onlineSince" ELSE now() END,
        "isOnline" = true,
        "updatedAt" = now()`;
  }

  async goOffline(userId: string) {
    await this.prisma.$executeRaw`
      UPDATE driver_presence
      SET "isOnline" = false, "onlineSince" = NULL, "updatedAt" = now()
      WHERE "userId" = ${userId}::uuid`;
  }

  async updateLocation(
    userId: string,
    at: LatLng,
    extra: { heading?: number; speedKmh?: number },
  ) {
    await this.prisma.$executeRaw`
      UPDATE driver_presence
      SET "location" = ST_SetSRID(ST_MakePoint(${at.lng}::float8, ${at.lat}::float8), 4326)::geography,
          "heading" = ${extra.heading ?? null}::float8,
          "speedKmh" = ${extra.speedKmh ?? null}::float8,
          "locationUpdatedAt" = now(),
          "updatedAt" = now()
      WHERE "userId" = ${userId}::uuid AND "isOnline"`;
  }

  async setBusy(userId: string, busy: boolean) {
    await this.prisma.$executeRaw`
      UPDATE driver_presence SET "busy" = ${busy}, "updatedAt" = now()
      WHERE "userId" = ${userId}::uuid`;
  }

  async findNearby(q: NearbyQuery): Promise<NearbyDriver[]> {
    const rows = await this.prisma.$queryRaw<
      {
        userId: string;
        vehicleId: string;
        category: VehicleCategory;
        distance: number;
        lat: number;
        lng: number;
        heading: number | null;
      }[]
    >`
      SELECT "userId", "vehicleId", "category",
             ST_Distance("location", ST_SetSRID(ST_MakePoint(${q.lng}::float8, ${q.lat}::float8), 4326)::geography) AS distance,
             ST_Y("location"::geometry) AS lat,
             ST_X("location"::geometry) AS lng,
             "heading"
      FROM driver_presence
      WHERE "isOnline" AND NOT "busy" AND "location" IS NOT NULL
        AND "locationUpdatedAt" > now() - make_interval(secs => ${this.ttlSeconds}::int)
        AND ST_DWithin("location", ST_SetSRID(ST_MakePoint(${q.lng}::float8, ${q.lat}::float8), 4326)::geography, ${q.radiusMeters}::float8)
        AND (${q.category ?? null}::"VehicleCategory" IS NULL OR "category" = ${q.category ?? null}::"VehicleCategory")
      ORDER BY distance
      LIMIT ${q.limit}::int`;
    return rows.map((r) => ({
      userId: r.userId,
      vehicleId: r.vehicleId,
      category: r.category,
      distanceMeters: Math.round(r.distance),
      lat: r.lat,
      lng: r.lng,
      heading: r.heading,
    }));
  }
}
