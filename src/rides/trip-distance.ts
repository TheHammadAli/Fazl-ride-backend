import { haversineMeters } from '../common/geo.js';
import type { LatLng } from '../common/geo.js';

// Consecutive GPS fixes closer than this are noise from a parked or crawling car.
export const MIN_LEG_METERS = 5;
// A single jump longer than this is a GPS glitch, not driving.
export const MAX_LEG_METERS = 5_000;

// Distance to add to a trip for one location update.
export function tripLeg(previous: LatLng, next: LatLng): number {
  const meters = haversineMeters(previous, next);
  return meters >= MIN_LEG_METERS && meters <= MAX_LEG_METERS ? meters : 0;
}

export interface FareRatesSnapshot {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
}

// Distance billed for a finished trip: what the GPS trail adds up to, but never
// less than the straight line from pickup to where the driver ended (a patchy
// trail must not undercharge). With no data at all, fall back to the estimate.
export function billedDistanceMeters(
  trackedMeters: number,
  straightLineMeters: number,
  estimatedMeters: number,
): number {
  const best = Math.max(trackedMeters, straightLineMeters);
  return Math.round(best > 0 ? best : estimatedMeters);
}
