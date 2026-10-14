import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import {
  AutocompleteQueryDto,
  PlaceDetailsQueryDto,
  ReverseQueryDto,
} from './places.dto.js';
import { PlacesService } from './places.service.js';

// The search box in the apps. 503 PLACES_UNAVAILABLE = not set up or Google
// is down; the apps then use their own fallback search.
@ApiTags('places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('autocomplete')
  autocomplete(@Query() q: AutocompleteQueryDto) {
    const near =
      q.lat !== undefined && q.lng !== undefined
        ? { lat: q.lat, lng: q.lng }
        : null;
    return this.places.autocomplete(q.q, near, q.session ?? null);
  }

  @Get('details')
  details(@Query() q: PlaceDetailsQueryDto) {
    return this.places.details(q.placeId, q.session ?? null);
  }

  // Names a point (the pickup pin). Nothing known there: all fields null.
  @Get('reverse')
  async reverse(@Query() q: ReverseQueryDto) {
    return (
      (await this.places.reverse({ lat: q.lat, lng: q.lng })) ?? {
        address: null,
        name: null,
        city: null,
      }
    );
  }
}
