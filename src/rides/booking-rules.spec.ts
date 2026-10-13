import { describe, expect, it } from 'vitest';
import {
  bookingKind,
  dueReminders,
  eveningBefore,
  reminderTimes,
  startWindow,
  type BookingRules,
} from './booking-rules.js';

const rules: BookingRules = {
  rideStartBefore: 60,
  rideStartAfter: 30,
  freightStartBefore: 90,
  freightStartAfter: 60,
  intercityStartBefore: 120,
  intercityStartAfter: 60,
  rideWarnFirst: 60,
  rideWarnSecond: 30,
  freightWarnFirst: 120,
  freightWarnSecond: 60,
  intercityWarnFirst: 360,
  intercityWarnSecond: 120,
  reminderMinutes: 60,
  startNudgeMinutes: 15,
  eveningReminderHour: 21,
};
const PKT = 300;
// 8:30 in Pakistan = 3:30 UTC.
const at = new Date('2026-10-15T03:30:00Z');

describe('bookingKind', () => {
  it('tells rides, freight and city to city apart', () => {
    expect(bookingKind('ride', 'within_city')).toBe('ride');
    expect(bookingKind('ride', 'city_to_city')).toBe('intercity');
    expect(bookingKind('freight', 'within_city')).toBe('freight');
  });
});

describe('startWindow', () => {
  it('opens an hour before a city ride and closes 30 minutes after', () => {
    const w = startWindow(at, 'ride', rules);
    expect(w.from.toISOString()).toBe('2026-10-15T02:30:00.000Z');
    expect(w.until.toISOString()).toBe('2026-10-15T04:00:00.000Z');
  });

  it('gives freight and city to city more room', () => {
    expect(startWindow(at, 'freight', rules).from.toISOString()).toBe(
      '2026-10-15T02:00:00.000Z',
    );
    expect(startWindow(at, 'intercity', rules).from.toISOString()).toBe(
      '2026-10-15T01:30:00.000Z',
    );
  });
});

describe('eveningBefore', () => {
  it('is 9 PM Pakistan time the day before', () => {
    // 9 PM on the 14th in Pakistan = 16:00 UTC.
    expect(eveningBefore(at, 21, PKT)?.toISOString()).toBe(
      '2026-10-14T16:00:00.000Z',
    );
  });

  it('is skipped for a booking soon after that evening', () => {
    // 1:30 AM Pakistan on the 15th: 9 PM the 14th is only 4.5 hours before.
    expect(eveningBefore(new Date('2026-10-14T20:30:00Z'), 21, PKT)).toBeNull();
  });
});

describe('reminders', () => {
  it('warns twice while nobody is confirmed', () => {
    const t = reminderTimes(
      { scheduledAt: at, confirmed: false, kind: 'ride' },
      rules,
      PKT,
    );
    expect(Object.keys(t).sort()).toEqual([
      'no_driver_first',
      'no_driver_second',
    ]);
    expect(t.no_driver_first?.toISOString()).toBe('2026-10-15T02:30:00.000Z');
  });

  it('reminds both people once a driver is confirmed', () => {
    const t = reminderTimes(
      { scheduledAt: at, confirmed: true, kind: 'ride' },
      rules,
      PKT,
    );
    expect(Object.keys(t).sort()).toEqual([
      'evening_before',
      'not_started',
      'start_nudge',
      'upcoming',
    ]);
  });

  it('sends what is due, once, and nothing stale or from before the booking', () => {
    const t = reminderTimes(
      { scheduledAt: at, confirmed: false, kind: 'ride' },
      rules,
      PKT,
    );
    const bookedLate = new Date('2026-10-15T02:50:00Z'); // 40 min before
    const now = new Date('2026-10-15T03:00:00Z'); // 30 min before
    expect(dueReminders(t, bookedLate, now, new Set())).toEqual([
      'no_driver_second',
    ]);
    expect(
      dueReminders(t, bookedLate, now, new Set(['no_driver_second'])),
    ).toEqual([]);
    const longAfter = new Date('2026-10-15T04:00:00Z');
    expect(dueReminders(t, new Date(0), longAfter, new Set())).toEqual([]);
  });
});
