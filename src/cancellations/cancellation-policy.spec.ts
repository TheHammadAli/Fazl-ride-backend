import { cooldownUntil, CancelRule } from './cancellation-policy.js';

// 3 cancellations within 60 minutes blocks for 30 minutes.
const rule: CancelRule = {
  limit: 3,
  windowMs: 60 * 60_000,
  cooldownMs: 30 * 60_000,
};
const t = (minutes: number) =>
  new Date(Date.UTC(2026, 8, 21, 10, 0, 0) + minutes * 60_000);

describe('cooldownUntil (3 in 60 min -> 30 min)', () => {
  it('two cancellations are fine', () => {
    expect(cooldownUntil([t(0), t(10)], t(15), rule)).toBeNull();
  });

  it('the third within the hour blocks until 30 min after that third one', () => {
    const until = cooldownUntil([t(0), t(10), t(20)], t(21), rule);
    expect(until?.toISOString()).toBe(t(50).toISOString());
  });

  it('the block ends exactly at that moment', () => {
    expect(cooldownUntil([t(0), t(10), t(20)], t(50), rule)).toBeNull();
    expect(cooldownUntil([t(0), t(10), t(20)], t(49.9), rule)).not.toBeNull();
  });

  it('three spread over more than an hour do not count', () => {
    // 0, 30 and 61 minutes: never three inside one hour.
    expect(cooldownUntil([t(0), t(30), t(61)], t(62), rule)).toBeNull();
  });

  it('exactly one hour apart still counts as inside the window', () => {
    expect(
      cooldownUntil([t(0), t(30), t(60)], t(61), rule)?.toISOString(),
    ).toBe(t(90).toISOString());
  });

  it('the block lasts even after the oldest cancellation left the window', () => {
    // 0, 55, 58 blocks until 88. At minute 70 the cancellation at 0 is more than an hour old.
    expect(
      cooldownUntil([t(0), t(55), t(58)], t(70), rule)?.toISOString(),
    ).toBe(t(88).toISOString());
  });

  it('a later cancellation extends the block', () => {
    const times = [t(0), t(10), t(20), t(60)]; // 10, 20, 60 is another set of three within an hour
    expect(cooldownUntil(times, t(61), rule)?.toISOString()).toBe(
      t(90).toISOString(),
    );
  });

  it('order of the input does not matter and an empty list is free', () => {
    expect(
      cooldownUntil([t(20), t(0), t(10)], t(21), rule)?.toISOString(),
    ).toBe(t(50).toISOString());
    expect(cooldownUntil([], t(0), rule)).toBeNull();
  });

  it('a limit of 1 blocks after every cancellation', () => {
    const strict = { ...rule, limit: 1 };
    expect(cooldownUntil([t(0)], t(10), strict)?.toISOString()).toBe(
      t(30).toISOString(),
    );
  });
});
