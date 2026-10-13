import { describe, expect, it } from 'vitest';
import {
  dueOccurrences,
  isoWeekday,
  localDate,
  nextRun,
  occurrenceAt,
  parseTime,
} from './schedule-rules.js';

const PKT = 300;
const weekdays = { days: [1, 2, 3, 4, 5], timeMinutes: 510 }; // Mon-Fri 8:30

describe('dates', () => {
  it('knows business-time days and weekdays', () => {
    // 2026-10-14 is a Wednesday; 21:00 UTC is already the 15th in Pakistan.
    expect(isoWeekday('2026-10-14')).toBe(3);
    expect(localDate(new Date('2026-10-14T21:00:00Z'), PKT)).toBe('2026-10-15');
    expect(occurrenceAt('2026-10-15', 510, PKT).toISOString()).toBe(
      '2026-10-15T03:30:00.000Z',
    );
  });

  it('parses times', () => {
    expect(parseTime('08:30')).toBe(510);
    expect(parseTime('8:05')).toBe(485);
    expect(parseTime('24:00')).toBeNull();
  });
});

describe('dueOccurrences', () => {
  const opts = { tzOffsetMinutes: PKT, aheadHours: 24, minAheadMinutes: 30 };

  it('makes tomorrow morning booking a day ahead', () => {
    // Wed 9:00 AM Pakistan: Thu 8:30 is 23.5 h ahead.
    const now = new Date('2026-10-14T04:00:00Z');
    expect(dueOccurrences(weekdays, now, opts).map((o) => o.date)).toEqual([
      '2026-10-15',
    ]);
  });

  it('skips weekends, skipped days and runs too close', () => {
    // Fri 9:00 AM: Sat and Sun are not schedule days.
    const fri = new Date('2026-10-16T04:00:00Z');
    expect(dueOccurrences(weekdays, fri, opts)).toEqual([]);
    // Wed 8:10 AM: today 8:30 is only 20 min away, tomorrow is skipped.
    const wed = new Date('2026-10-14T03:10:00Z');
    expect(
      dueOccurrences(weekdays, wed, {
        ...opts,
        skipped: new Set(['2026-10-15']),
      }),
    ).toEqual([]);
  });

  it('finds the next run for the app', () => {
    const fri = new Date('2026-10-16T04:00:00Z');
    expect(nextRun(weekdays, fri, PKT)?.toISOString()).toBe(
      '2026-10-19T03:30:00.000Z',
    );
    expect(nextRun({ days: [], timeMinutes: 510 }, fri, PKT)).toBeNull();
  });
});
