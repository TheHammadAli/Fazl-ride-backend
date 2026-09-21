export interface FareRates {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
}

// base + distance + time, never below the minimum fare, whole PKR.
export function calculateFare(
  rates: FareRates,
  distanceMeters: number,
  durationSeconds: number,
): number {
  const raw =
    rates.baseFare +
    (rates.perKm * distanceMeters) / 1000 +
    (rates.perMinute * durationSeconds) / 60;
  return Math.max(rates.minimumFare, Math.round(raw));
}
