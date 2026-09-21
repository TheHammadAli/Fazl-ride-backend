// "Today" for dashboards and earnings means the business's local day, not UTC.
// Pakistan is UTC+5 all year (no daylight saving); override with BUSINESS_TZ_OFFSET_MINUTES.
export const DEFAULT_TZ_OFFSET_MINUTES = 300;

export function startOfBusinessDay(
  now: Date,
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): Date {
  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMinutes * 60_000);
}
