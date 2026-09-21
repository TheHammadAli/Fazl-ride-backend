import { periodBounds, startOfBusinessDay } from './time.js';

describe('startOfBusinessDay (UTC+5)', () => {
  it('rolls to the local midnight, which is 19:00 UTC the day before', () => {
    // 2026-09-21 10:00 PKT = 05:00 UTC
    expect(
      startOfBusinessDay(new Date('2026-09-21T05:00:00Z')).toISOString(),
    ).toBe('2026-09-20T19:00:00.000Z');
  });

  it('a time after local midnight but before UTC midnight is still the new local day', () => {
    // 2026-09-21 02:00 PKT = 2026-09-20 21:00 UTC
    expect(
      startOfBusinessDay(new Date('2026-09-20T21:00:00Z')).toISOString(),
    ).toBe('2026-09-20T19:00:00.000Z');
  });

  it('honours another offset', () => {
    expect(
      startOfBusinessDay(new Date('2026-09-21T05:00:00Z'), 0).toISOString(),
    ).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('periodBounds (UTC+5)', () => {
  // Monday 21 Sep 2026, 15:00 in Pakistan
  const monday = new Date('2026-09-21T15:00:00+05:00');

  it('today starts at local midnight', () => {
    expect(periodBounds('today', monday).from.toISOString()).toBe(
      '2026-09-20T19:00:00.000Z',
    );
  });

  it('on a Monday the week starts today', () => {
    expect(periodBounds('week', monday).from.toISOString()).toBe(
      '2026-09-20T19:00:00.000Z',
    );
  });

  it('on Sunday the week still started the Monday before', () => {
    const sunday = new Date('2026-09-27T22:00:00+05:00');
    expect(periodBounds('week', sunday).from.toISOString()).toBe(
      '2026-09-20T19:00:00.000Z',
    );
  });

  it('midweek counts back to Monday', () => {
    const thursday = new Date('2026-09-24T09:00:00+05:00');
    expect(periodBounds('week', thursday).from.toISOString()).toBe(
      '2026-09-20T19:00:00.000Z',
    );
  });

  it('the month starts on the 1st at local midnight', () => {
    expect(periodBounds('month', monday).from.toISOString()).toBe(
      '2026-08-31T19:00:00.000Z',
    );
  });

  it('just after local midnight on the 1st is already the new month', () => {
    const first = new Date('2026-10-01T00:30:00+05:00');
    expect(periodBounds('month', first).from.toISOString()).toBe(
      '2026-09-30T19:00:00.000Z',
    );
  });

  it('every period ends now', () => {
    expect(periodBounds('week', monday).to).toBe(monday);
  });
});
