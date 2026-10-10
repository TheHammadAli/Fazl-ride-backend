import { haversineMeters, type LatLng } from '../common/geo.js';

export interface DestinationRuleSettings {
  // A drop-off this close to the destination always counts.
  nearMeters: number;
  // Otherwise the trip must cover at least this share of the way there ...
  minProgress: number;
  // ... and driver -> pickup -> drop-off -> destination may be at most this
  // much longer than driving there directly (plus slackMeters).
  maxDetour: number;
  slackMeters: number;
}

export const DEFAULT_DESTINATION_RULE: DestinationRuleSettings = {
  nearMeters: 5_000,
  minProgress: 0.3,
  maxDetour: 1.5,
  slackMeters: 3_000,
};

// Whether a ride takes a driver in destination mode towards their
// destination: it ends nearer to it than they are now, and getting there
// through the pickup and drop-off is not a long way round. Straight-line
// distances, like the rest of matching.
export function takesTowardsDestination(
  driver: LatLng,
  pickup: LatLng,
  dropoff: LatLng,
  destination: LatLng,
  rule: DestinationRuleSettings = DEFAULT_DESTINATION_RULE,
): boolean {
  const direct = haversineMeters(driver, destination);
  const left = haversineMeters(dropoff, destination);
  if (left >= direct) return false;
  const progressOk =
    left <= rule.nearMeters || direct - left >= rule.minProgress * direct;
  if (!progressOk) return false;
  const viaTrip =
    haversineMeters(driver, pickup) + haversineMeters(pickup, dropoff) + left;
  return viaTrip <= direct * rule.maxDetour + rule.slackMeters;
}
