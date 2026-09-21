import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';
import { VehicleCategory } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateFareConfigDto } from './dto/fare-config.dto.js';
import { calculateFare } from './fare.calculator.js';
import { RoutingProvider } from './routing/routing.provider.js';

const MIN_TRIP_METERS = 50;
const MAX_TRIP_METERS = 200_000;
// Drivers further than this from the pickup are not shown as "nearby".
const NEARBY_RADIUS_METERS = 5_000;

@Injectable()
export class FaresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingProvider,
    private readonly locations: DriverLocationStore,
    private readonly audit: AuditService,
  ) {}

  listConfigs() {
    return this.prisma.fareConfig.findMany({ orderBy: { baseFare: 'asc' } });
  }

  async updateConfig(
    category: VehicleCategory,
    dto: UpdateFareConfigDto,
    actorId: string,
  ) {
    const existing = await this.prisma.fareConfig.findUnique({
      where: { category },
    });
    if (!existing) throw new NotFoundException('Fare config not found');
    const updated = await this.prisma.fareConfig.update({
      where: { category },
      data: dto,
    });
    await this.audit.log(actorId, 'fare.update', 'fare_config', category, {
      before: JSON.parse(JSON.stringify(existing)),
      changes: Object.fromEntries(Object.entries(dto)),
    });
    return updated;
  }

  private assertReasonableTrip(pickup: LatLng, dropoff: LatLng) {
    const straight = haversineMeters(pickup, dropoff);
    if (straight < MIN_TRIP_METERS) {
      throw new BadRequestException(
        'Pickup and drop-off are too close together',
      );
    }
    if (straight > MAX_TRIP_METERS) {
      throw new BadRequestException(
        'Trips longer than 200 km are not supported',
      );
    }
  }

  // Price and route for one category, used when a ride is actually requested.
  async quote(pickup: LatLng, dropoff: LatLng, category: VehicleCategory) {
    this.assertReasonableTrip(pickup, dropoff);
    const [route, config] = await Promise.all([
      this.routing.route(pickup, dropoff),
      this.prisma.fareConfig.findUnique({ where: { category } }),
    ]);
    if (!config) throw new NotFoundException('Fare config not found');
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      fare: calculateFare(config, route.distanceMeters, route.durationSeconds),
      cancellationFee: config.cancellationFee,
    };
  }

  // Price for every category for one route, so the app can show them side by side.
  async estimate(pickup: LatLng, dropoff: LatLng) {
    this.assertReasonableTrip(pickup, dropoff);
    const [route, configs, nearby] = await Promise.all([
      this.routing.route(pickup, dropoff),
      this.listConfigs(),
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
          cancellationFee: config.cancellationFee,
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
      estimates,
    };
  }
}
