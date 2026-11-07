import type { LatLng } from '../common/geo.js';

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
}

// Distance and travel time between two points. Swap the implementation bound
// in RidesModule (for example Google Directions) without touching ride logic.
// `speedKmh`: how fast the vehicle really goes (travel-speed.ts), when known.
export abstract class RoutingProvider {
  abstract route(
    from: LatLng,
    to: LatLng,
    speedKmh?: number,
  ): Promise<RouteEstimate>;
}
