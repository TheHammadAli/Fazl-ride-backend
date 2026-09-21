import type { LatLng } from '../../common/geo.js';

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
}

// Distance and travel time between two points. Swap the implementation bound
// in RidesModule (for example Google Directions) without touching ride logic.
export abstract class RoutingProvider {
  abstract route(from: LatLng, to: LatLng): Promise<RouteEstimate>;
}
