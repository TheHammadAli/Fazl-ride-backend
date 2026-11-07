import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';
import { AuditService } from '../audit/audit.service.js';
import {
  DriverLocationStore,
  type NearbyDriver,
} from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateFareConfigDto } from './dto/fare-config.dto.js';
import { calculateFare } from './fare.calculator.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { travelSpeedKmh } from '../routing/travel-speed.js';
import { RideSettings } from './rides.settings.js';
import { TripType } from '../generated/prisma/enums.js';

const MIN_TRIP_METERS = 50;
// city_to_city covers any route inside Pakistan (Karachi-Peshawar is around
// 1,600 km); within_city is capped at RideSettings.withinCityMaxMeters.
const CITY_TO_CITY_MAX_METERS = 2_000_000;
// Drivers further than this from the pickup are not shown as "nearby".
const NEARBY_RADIUS_METERS = 5_000;
const NEARBY_LIMIT = 50;

// How fast these drivers really go: the mean of their live averages.
const speedOf = (drivers: NearbyDriver[]) =>
  travelSpeedKmh(drivers.map((d) => d.avgSpeedKmh));

@Injectable()
export class FaresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingProvider,
    private readonly locations: DriverLocationStore,
    private readonly audit: AuditService,
    private readonly settings: RideSettings,
  ) {}

  // Admin's own list (GET admin/fares) - every category, active or not, so a
  // deactivated one can still be found and re-enabled. Optionally narrowed to
  // one trip type.
  listConfigs(tripType?: TripType) {
    return this.prisma.fareConfig.findMany({
      where: tripType ? { tripType } : undefined,
      orderBy: [{ tripType: 'asc' }, { baseFare: 'asc' }],
    });
  }

  // Only categories a passenger can actually book right now, for one trip type.
  private listActiveConfigs(tripType: TripType, service: string) {
    return this.prisma.fareConfig.findMany({
      where: { tripType, categoryRef: { active: true, service } },
      orderBy: { baseFare: 'asc' },
    });
  }

  async updateConfig(
    category: string,
    tripType: TripType,
    dto: UpdateFareConfigDto,
    actorId: string,
  ) {
    const existing = await this.prisma.fareConfig.findUnique({
      where: { category_tripType: { category, tripType } },
    });
    if (!existing) throw new NotFoundException('Fare config not found');
    const updated = await this.prisma.fareConfig.update({
      where: { category_tripType: { category, tripType } },
      data: dto,
    });
    const auditKey = `${category}/${tripType}`;
    await this.audit.log(actorId, 'fare.update', 'fare_config', auditKey, {
      before: JSON.parse(JSON.stringify(existing)),
      changes: Object.fromEntries(Object.entries(dto)),
    });
    return updated;
  }

  // `stops`: places on the way, in order. A trip may come back to where it
  // started (pickup, a stop, home again) as long as it goes somewhere.
  private assertReasonableTrip(
    pickup: LatLng,
    dropoff: LatLng,
    tripType: TripType,
    stops: LatLng[] = [],
  ) {
    const points = [pickup, ...stops, dropoff];
    const path = points
      .slice(1)
      .reduce((sum, to, i) => sum + haversineMeters(points[i], to), 0);
    if (path < MIN_TRIP_METERS) {
      throw new BadRequestException(
        'Pickup and drop-off are too close together',
      );
    }
    const furthest = Math.max(
      ...points.slice(1).map((p) => haversineMeters(pickup, p)),
    );
    // Further than any one city reaches: the cheaper in-city rates do not
    // apply, whatever the app sent.
    if (
      tripType === TripType.within_city &&
      furthest > this.settings.withinCityMaxMeters
    ) {
      throw new BadRequestException(
        'This trip goes between cities. Book it as City to City.',
      );
    }
    if (furthest > CITY_TO_CITY_MAX_METERS) {
      throw new BadRequestException(
        `Trips longer than ${CITY_TO_CITY_MAX_METERS / 1000} km are not supported`,
      );
    }
  }

  // Distance and time through every point in order: pickup, the stops, the
  // drop-off - the time at `speedKmh` when given.
  private async routeThrough(points: LatLng[], speedKmh?: number) {
    const legs = await Promise.all(
      points
        .slice(1)
        .map((to, i) => this.routing.route(points[i], to, speedKmh)),
    );
    return legs.reduce(
      (sum, leg) => ({
        distanceMeters: sum.distanceMeters + leg.distanceMeters,
        durationSeconds: sum.durationSeconds + leg.durationSeconds,
      }),
      { distanceMeters: 0, durationSeconds: 0 },
    );
  }

  // Price and route for one category, used when a ride is actually requested.
  async quote(
    pickup: LatLng,
    dropoff: LatLng,
    category: string,
    tripType: TripType,
    stops: LatLng[] = [],
  ) {
    this.assertReasonableTrip(pickup, dropoff, tripType, stops);
    const [drivers, config] = await Promise.all([
      this.locations.findNearby({
        ...pickup,
        radiusMeters: NEARBY_RADIUS_METERS,
        category,
        limit: NEARBY_LIMIT,
      }),
      this.prisma.fareConfig.findUnique({
        where: { category_tripType: { category, tripType } },
        include: { categoryRef: true },
      }),
    ]);
    if (!config || !config.categoryRef.active) {
      throw new NotFoundException('Fare config not found');
    }
    // Timed like the estimate the passenger just saw: at the speed this
    // type's drivers go around the pickup.
    const route = await this.routeThrough(
      [pickup, ...stops, dropoff],
      speedOf(drivers),
    );
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      fare: calculateFare(config, route.distanceMeters, route.durationSeconds),
      // Kept with the ride so the final fare uses the prices the passenger saw.
      rates: {
        baseFare: config.baseFare,
        perKm: config.perKm,
        perMinute: config.perMinute,
        minimumFare: config.minimumFare,
        freeWaitingMinutes: config.freeWaitingMinutes,
        waitingPerMinute: config.waitingPerMinute,
      },
    };
  }

  // Price for every category for one route, so the app can show them side by side.
  // `service` keeps trucks out of the passenger list and cars out of freight.
  async estimate(
    pickup: LatLng,
    dropoff: LatLng,
    tripType: TripType,
    service = 'ride',
    stops: LatLng[] = [],
  ) {
    if (stops.length && service !== 'ride') {
      throw new BadRequestException('Stops on the way are for rides only');
    }
    this.assertReasonableTrip(pickup, dropoff, tripType, stops);
    const points = [pickup, ...stops, dropoff];
    const [route, configs, nearby] = await Promise.all([
      this.routeThrough(points),
      this.listActiveConfigs(tripType, service),
      this.locations.findNearby({
        ...pickup,
        radiusMeters: NEARBY_RADIUS_METERS,
        limit: NEARBY_LIMIT,
      }),
    ]);
    const estimates = await Promise.all(
      configs.map(async (config) => {
        // Drivers whose vehicle may take this type (tiers included).
        const drivers = nearby.filter((d) =>
          d.categories.includes(config.category),
        );
        // This type's own time: as fast as its drivers go around here, so a
        // bike and a car on the same road take different times.
        const speedKmh = speedOf(drivers);
        const trip = await this.routeThrough(points, speedKmh);
        const nearest = drivers[0]; // already ordered by distance
        const toPickup = nearest
          ? await this.routing.route(
              { lat: nearest.lat, lng: nearest.lng },
              pickup,
              nearest.avgSpeedKmh ?? speedKmh,
            )
          : null;
        return {
          category: config.category,
          fare: calculateFare(
            config,
            trip.distanceMeters,
            trip.durationSeconds,
          ),
          durationSeconds: trip.durationSeconds,
          nearbyDrivers: drivers.length,
          pickupEtaSeconds: toPickup?.durationSeconds ?? null,
          pickupDistanceMeters: toPickup?.distanceMeters ?? null,
          // What waiting at a stop costs on top of the fare.
          waiting: {
            freeMinutes: config.freeWaitingMinutes,
            perMinute: config.waitingPerMinute,
          },
        };
      }),
    );
    return {
      distanceMeters: route.distanceMeters,
      // At the default speed; each estimate has its own type's time.
      durationSeconds: route.durationSeconds,
      stops: stops.length,
      currency: 'PKR',
      tripType,
      // Lets the app decide, before requesting, whether to show an editable
      // "your price" (bidding) or just a Book button (fixed) - RIDE_PRICING_MODE.
      negotiable: this.settings.pricingMode === 'bidding',
      estimates,
    };
  }
}
