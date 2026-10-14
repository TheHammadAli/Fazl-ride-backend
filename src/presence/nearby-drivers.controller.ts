import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { DriverLocationStore } from './driver-location.store.js';
import { NearbyDriversQueryDto } from './dto/nearby-drivers.dto.js';

const DEFAULT_RADIUS_METERS = 5_000;
const MAX_MARKERS = 200;

// For the Home map: "how many drivers are around here", for any point the
// person is looking at - their own city, or one they are about to travel to.
// Signed in (passenger or driver), nothing role-specific.
@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class NearbyDriversController {
  constructor(private readonly locations: DriverLocationStore) {}

  @Get('nearby')
  async nearby(@Query() query: NearbyDriversQueryDto) {
    const drivers = await this.locations.findNearby({
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters ?? DEFAULT_RADIUS_METERS,
      category: query.category,
      limit: MAX_MARKERS,
    });
    // Only what a map marker needs - never who the driver is, before they are
    // actually on someone's ride.
    return {
      drivers: drivers.map((d) => ({
        lat: d.lat,
        lng: d.lng,
        category: d.category,
        // Ride types it can take (tiers), so a map can show e.g. AC cars.
        categories: d.categories,
        heading: d.heading,
      })),
    };
  }
}
