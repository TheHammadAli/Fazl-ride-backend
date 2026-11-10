import { Injectable } from '@nestjs/common';
import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';
import { RouteEstimate, RoutingProvider } from './routing.provider.js';
import { DEFAULT_SPEED_KMH } from './travel-speed.js';

// Roads are longer than a straight line, so the straight-line distance is
// scaled up; the time is that distance at the speed drivers really go (see
// travel-speed.ts), or the default when it is not known.
export const DETOUR_FACTOR = 1.35;

@Injectable()
export class HaversineRoutingProvider extends RoutingProvider {
  async route(
    from: LatLng,
    to: LatLng,
    speedKmh = DEFAULT_SPEED_KMH,
  ): Promise<RouteEstimate> {
    const distanceMeters = Math.round(
      haversineMeters(from, to) * DETOUR_FACTOR,
    );
    const durationSeconds = Math.round(
      distanceMeters / ((speedKmh * 1000) / 3600),
    );
    return { distanceMeters, durationSeconds };
  }
}
