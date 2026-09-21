import { startOfBusinessDay } from './time.js';

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
