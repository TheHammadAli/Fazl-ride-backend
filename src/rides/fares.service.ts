import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';
import { AuditService } from '../audit/audit.service.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateFareConfigDto } from './dto/fare-config.dto.js';
import { calculateFare } from './fare.calculator.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { RideSettings } from './rides.settings.js';
import { TripType } from '../generated/prisma/enums.js';

const MIN_TRIP_METERS = 50;
// city_to_city covers any route inside Pakistan (Karachi-Peshawar is around
// 1,600 km); within_city is capped at RideSettings.withinCityMaxMeters.
const CITY_TO_CITY_MAX_METERS = 2_000_000;
// Drivers further than this from the pickup are not shown as "nearby".
const NEARBY_RADIUS_METERS = 5_000;

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

  private assertReasonableTrip(
    pickup: LatLng,
    dropoff: LatLng,
    tripType: TripType,
  ) {
    const straight = haversineMeters(pickup, dropoff);
    if (straight < MIN_TRIP_METERS) {
      throw new BadRequestException(
        'Pickup and drop-off are too close together',
      );
    }
    // Further than any one city reaches: the cheaper in-city rates do not
    // apply, whatever the app sent.
    if (
      tripType === TripType.within_city &&
      straight > this.settings.withinCityMaxMeters
    ) {
      throw new BadRequestException(
        'This trip goes between cities. Book it as City to City.',
      );
    }
    if (straight > CITY_TO_CITY_MAX_METERS) {
      throw new BadRequestException(
        `Trips longer than ${CITY_TO_CITY_MAX_METERS / 1000} km are not supported`,
      );
    }
  }

  // Price and route for one category, used when a ride is actually requested.
  async quote(
    pickup: LatLng,
    dropoff: LatLng,
    category: string,
    tripType: TripType,
  ) {
    this.assertReasonableTrip(pickup, dropoff, tripType);
    const [route, config] = await Promise.all([
      this.routing.route(pickup, dropoff),
      this.prisma.fareConfig.findUnique({
        where: { category_tripType: { category, tripType } },
        include: { categoryRef: true },
      }),
    ]);
    if (!config || !config.categoryRef.active) {
      throw new NotFoundException('Fare config not found');
    }
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
  ) {
    this.assertReasonableTrip(pickup, dropoff, tripType);
    const [route, configs, nearby] = await Promise.all([
      this.routing.route(pickup, dropoff),
      this.listActiveConfigs(tripType, service),
      this.locations.findNearby({
        ...pickup,
        radiusMeters: NEARBY_RADIUS_METERS,
        limit: 50,
      }),
    ]);
    const estimates = await Promise.all(
      configs.map(async (config) => {
        const drivers = nearby.filter((d) => d.category === config.category);
        const nearest = drivers[0]; // already ordered by distance
        const toPickup = nearest
          ? await this.routing.route(
              { lat: nearest.lat, lng: nearest.lng },
              pickup,
            )
          : null;
        return {
          category: config.category,
          fare: calculateFare(
            config,
            route.distanceMeters,
            route.durationSeconds,
          ),
          nearbyDrivers: drivers.length,
          pickupEtaSeconds: toPickup?.durationSeconds ?? null,
          pickupDistanceMeters: toPickup?.distanceMeters ?? null,
        };
      }),
    );
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      currency: 'PKR',
      tripType,
      // Lets the app decide, before requesting, whether to show an editable
      // "your price" (bidding) or just a Book button (fixed) - RIDE_PRICING_MODE.
      negotiable: this.settings.pricingMode === 'bidding',
      estimates,
    };
  }
}
