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

export type Period = 'today' | 'week' | 'month';

// Start of the reporting period in business-local time. The week starts on
// Monday and the month on the 1st; every period ends "now".
export function periodBounds(
  period: Period,
  now: Date,
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): { from: Date; to: Date } {
  const dayStart = startOfBusinessDay(now, offsetMinutes);
  if (period === 'today') return { from: dayStart, to: now };

  // Shift so the UTC getters read the business-local calendar.
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  if (period === 'week') {
    const sinceMonday = (local.getUTCDay() + 6) % 7;
    return {
      from: new Date(dayStart.getTime() - sinceMonday * 86_400_000),
      to: now,
    };
  }
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return { from: new Date(monthStart - offsetMinutes * 60_000), to: now };
}
