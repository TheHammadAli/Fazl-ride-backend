// Travel times come from how fast drivers actually go, read off their GPS:
// each driver keeps a running average of their speed while moving, and a trip
// with no driver yet uses the average of the drivers of that type around it.

// The guess when nobody has driven yet (and the old fixed speed).
export const DEFAULT_SPEED_KMH = 25;

// Below this the vehicle is standing (a signal, a jam, the pickup): left out,
// so one red light does not make every time shoot up.
export const MOVING_KMH = 5;

// How much one GPS reading moves the average. Positions come every 2-4 s, so
// the average follows the last minute or so of driving.
export const SPEED_SMOOTHING = 0.1;

// A glitching reading (GPS jumping) must not give absurd times.
const SLOWEST_KMH = 8;
const FASTEST_KMH = 100;

const clamp = (kmh: number) =>
  Math.min(FASTEST_KMH, Math.max(SLOWEST_KMH, kmh));

// A driver's average after one more GPS reading. Standing still, or no speed
// from the phone, leaves it as it was.
export function nextAverageSpeed(
  average: number | null | undefined,
  speedKmh: number | null | undefined,
): number | null {
  if (speedKmh == null || speedKmh < MOVING_KMH) return average ?? null;
  const reading = clamp(speedKmh);
  if (average == null) return reading;
  return average + (reading - average) * SPEED_SMOOTHING;
}

// The speed to time a trip at: one driver's average, or the mean of several
// (the drivers of that type nearby). Nobody known: the default.
export function travelSpeedKmh(
  averages: (number | null | undefined)[],
): number {
  const known = averages.filter((s): s is number => s != null && s > 0);
  if (!known.length) return DEFAULT_SPEED_KMH;
  return clamp(known.reduce((sum, s) => sum + s, 0) / known.length);
}
