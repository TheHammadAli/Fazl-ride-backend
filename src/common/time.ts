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

export type Period = 'today' | 'week' | 'last_week' | 'month' | 'year' | 'all';

// Start of the reporting period in business-local time. The week starts on
// Monday, the month on the 1st and the year on 1 January; "all" is everything
// so far. Every period ends "now", except last week, which ends where this
// week starts.
export function periodBounds(
  period: Period,
  now: Date,
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): { from: Date; to: Date } {
  if (period === 'all') return { from: new Date(0), to: now };
  const dayStart = startOfBusinessDay(now, offsetMinutes);
  if (period === 'today') return { from: dayStart, to: now };

  // Shift so the UTC getters read the business-local calendar.
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  if (period === 'week' || period === 'last_week') {
    const sinceMonday = (local.getUTCDay() + 6) % 7;
    const weekStart = new Date(dayStart.getTime() - sinceMonday * 86_400_000);
    return period === 'week'
      ? { from: weekStart, to: now }
      : { from: new Date(weekStart.getTime() - 7 * 86_400_000), to: weekStart };
  }
  if (period === 'year') {
    const yearStart = Date.UTC(local.getUTCFullYear(), 0, 1);
    return { from: new Date(yearStart - offsetMinutes * 60_000), to: now };
  }
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return { from: new Date(monthStart - offsetMinutes * 60_000), to: now };
}
