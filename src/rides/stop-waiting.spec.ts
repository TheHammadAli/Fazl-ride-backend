import {
  stopWaitingCharge,
  waitedSeconds,
  waitingRatesOf,
} from './stop-waiting.js';

describe('waiting at a stop', () => {
  const rates = { freeWaitingMinutes: 3, waitingPerMinute: 10 };

  it('costs nothing within the free minutes', () => {
    expect(stopWaitingCharge(0, rates, 60)).toBe(0);
    expect(stopWaitingCharge(180, rates, 60)).toBe(0);
  });

  it('charges every minute begun after the free ones', () => {
    expect(stopWaitingCharge(181, rates, 60)).toBe(10);
    expect(stopWaitingCharge(240, rates, 60)).toBe(10);
    expect(stopWaitingCharge(241, rates, 60)).toBe(20);
    expect(stopWaitingCharge(10 * 60, rates, 60)).toBe(70);
  });

  it('counts at most the cap, so a forgotten Continue does not run up the bill', () => {
    expect(stopWaitingCharge(5 * 3600, rates, 30)).toBe(270);
  });

  it('charges from the first minute when nothing is free, and nothing at a zero rate', () => {
    expect(
      stopWaitingCharge(30, { freeWaitingMinutes: 0, waitingPerMinute: 8 }, 60),
    ).toBe(8);
    expect(
      stopWaitingCharge(
        3600,
        { freeWaitingMinutes: 0, waitingPerMinute: 0 },
        60,
      ),
    ).toBe(0);
  });

  it('rounds a fractional rate to whole rupees', () => {
    expect(
      stopWaitingCharge(
        5 * 60,
        { freeWaitingMinutes: 3, waitingPerMinute: 2.5 },
        60,
      ),
    ).toBe(5);
  });

  it('measures the wait, never below zero', () => {
    const at = new Date('2026-11-03T10:00:00Z');
    expect(waitedSeconds(at, new Date('2026-11-03T10:04:30Z'))).toBe(270);
    expect(waitedSeconds(at, new Date('2026-11-03T09:59:00Z'))).toBe(0);
  });

  it('reads the rates a ride was quoted, and waits for free on an older ride', () => {
    expect(
      waitingRatesOf({
        baseFare: 100,
        freeWaitingMinutes: 5,
        waitingPerMinute: 12,
      }),
    ).toEqual({ freeWaitingMinutes: 5, waitingPerMinute: 12 });
    expect(waitingRatesOf({ baseFare: 100 })).toEqual({
      freeWaitingMinutes: 0,
      waitingPerMinute: 0,
    });
    expect(waitingRatesOf(null)).toEqual({
      freeWaitingMinutes: 0,
      waitingPerMinute: 0,
    });
  });
});
