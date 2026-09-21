import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';
import { VehicleCategory } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateFareConfigDto } from './dto/fare-config.dto.js';
import { calculateFare } from './fare.calculator.js';
import { RoutingProvider } from './routing/routing.provider.js';

const MIN_TRIP_METERS = 50;
const MAX_TRIP_METERS = 200_000;

@Injectable()
export class FaresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: RoutingProvider,
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

  // Price for every category for one route, so the app can show them side by side.
  async estimate(pickup: LatLng, dropoff: LatLng) {
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
    const [route, configs] = await Promise.all([
      this.routing.route(pickup, dropoff),
      this.listConfigs(),
    ]);
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      currency: 'PKR',
      estimates: configs.map((config) => ({
        category: config.category,
        fare: calculateFare(
          config,
          route.distanceMeters,
          route.durationSeconds,
        ),
        cancellationFee: config.cancellationFee,
      })),
    };
  }
}
