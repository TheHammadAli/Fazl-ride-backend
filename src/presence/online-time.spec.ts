import { startOfBusinessDay } from '../common/time.js';
import { onlineSecondsSince } from './online-time.js';

// All times are Pakistan time (UTC+5); the "day" starts at 00:00 PKT = 19:00 UTC.
const pkt = (iso: string) => new Date(`${iso}+05:00`);
const now = pkt('2026-09-21T15:00:00');
const dayStart = startOfBusinessDay(now);

describe('onlineSecondsSince', () => {
  it('a finished session counts exactly its length: 10:00-12:00 is 7200 s', () => {
    const s = [
      {
        startedAt: pkt('2026-09-21T10:00:00'),
        endedAt: pkt('2026-09-21T12:00:00'),
      },
    ];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(7200);
  });

  it('a session still open counts up to now: 12:30-15:00 is 9000 s', () => {
    const s = [{ startedAt: pkt('2026-09-21T12:30:00'), endedAt: null }];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(9000);
  });

  it('a session that began yesterday counts only after local midnight: 23:00-01:00 is 3600 s today', () => {
    const s = [
      {
        startedAt: pkt('2026-09-20T23:00:00'),
        endedAt: pkt('2026-09-21T01:00:00'),
      },
    ];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(3600);
  });

  it('an open session that began yesterday counts from midnight to now: 15 h', () => {
    const s = [{ startedAt: pkt('2026-09-20T22:00:00'), endedAt: null }];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(15 * 3600);
  });

  it('a session that ended yesterday counts nothing', () => {
    const s = [
      {
        startedAt: pkt('2026-09-20T08:00:00'),
        endedAt: pkt('2026-09-20T20:00:00'),
      },
    ];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(0);
  });

  it('adds several sessions: 1 h + 30 min + open 1 h = 9000 s', () => {
    const s = [
      {
        startedAt: pkt('2026-09-21T08:00:00'),
        endedAt: pkt('2026-09-21T09:00:00'),
      },
      {
        startedAt: pkt('2026-09-21T10:00:00'),
        endedAt: pkt('2026-09-21T10:30:00'),
      },
      { startedAt: pkt('2026-09-21T14:00:00'), endedAt: null },
    ];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(3600 + 1800 + 3600);
  });

  it('never counts time after now (clock skew on a stored end time)', () => {
    const s = [
      {
        startedAt: pkt('2026-09-21T14:00:00'),
        endedAt: pkt('2026-09-21T18:00:00'),
      },
    ];
    expect(onlineSecondsSince(s, dayStart, now)).toBe(3600);
  });

  it('no sessions is 0', () => {
    expect(onlineSecondsSince([], dayStart, now)).toBe(0);
  });
});
