import { Injectable } from '@nestjs/common';
import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';
import { RouteEstimate, RoutingProvider } from './routing.provider.js';

// Roads are longer than a straight line and city traffic is slow, so the
// straight-line distance is scaled up and an average speed is assumed.
export const DETOUR_FACTOR = 1.35;
export const AVERAGE_SPEED_KMH = 25;

@Injectable()
export class HaversineRoutingProvider extends RoutingProvider {
  async route(from: LatLng, to: LatLng): Promise<RouteEstimate> {
    const distanceMeters = Math.round(
      haversineMeters(from, to) * DETOUR_FACTOR,
    );
    const durationSeconds = Math.round(
      distanceMeters / ((AVERAGE_SPEED_KMH * 1000) / 3600),
    );
    return { distanceMeters, durationSeconds };
  }
}
