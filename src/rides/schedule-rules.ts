// Frequent traveler: which days a repeating trip runs and when its next
// bookings are due, in business time. No database here.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// "2026-10-15" for a business-time day.
export function localDate(at: Date, tzOffsetMinutes: number): string {
  return new Date(at.getTime() + tzOffsetMinutes * MIN)
    .toISOString()
    .slice(0, 10);
}

// 1 = Monday ... 7 = Sunday, for a business-time day.
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

// The moment a schedule runs on a business-time date.
export function occurrenceAt(
  date: string,
  timeMinutes: number,
  tzOffsetMinutes: number,
): Date {
  return new Date(
    Date.parse(`${date}T00:00:00Z`) + (timeMinutes - tzOffsetMinutes) * MIN,
  );
}

// The runs of a schedule that should have a booking now: on one of its days,
// not skipped, later than `minAheadMinutes` from now and at most
// `aheadHours` ahead.
export function dueOccurrences(
  schedule: { days: number[]; timeMinutes: number },
  now: Date,
  opts: {
    tzOffsetMinutes: number;
    aheadHours: number;
    minAheadMinutes: number;
    skipped?: Set<string>;
  },
): { date: string; at: Date }[] {
  const out: { date: string; at: Date }[] = [];
  const first = localDate(now, opts.tzOffsetMinutes);
  const days = Math.ceil(opts.aheadHours / 24) + 1;
  for (let i = 0; i <= days; i++) {
    const date = new Date(Date.parse(`${first}T00:00:00Z`) + i * DAY)
      .toISOString()
      .slice(0, 10);
    if (!schedule.days.includes(isoWeekday(date))) continue;
    if (opts.skipped?.has(date)) continue;
    const at = occurrenceAt(date, schedule.timeMinutes, opts.tzOffsetMinutes);
    const ahead = at.getTime() - now.getTime();
    if (ahead < opts.minAheadMinutes * MIN) continue;
    if (ahead > opts.aheadHours * 60 * MIN) continue;
    out.push({ date, at });
  }
  return out;
}

// The next time a schedule runs (for the app), or null if it has no days.
export function nextRun(
  schedule: { days: number[]; timeMinutes: number },
  now: Date,
  tzOffsetMinutes: number,
  skipped: Set<string> = new Set(),
): Date | null {
  const runs = dueOccurrences(schedule, now, {
    tzOffsetMinutes,
    aheadHours: 15 * 24,
    minAheadMinutes: 0,
    skipped,
  });
  return runs[0]?.at ?? null;
}

// "08:30" -> 510.
export function parseTime(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
