import { describe, expect, it } from 'vitest';
import { discountFor, normalizeCode, promoProblem } from './promo-rules.js';

const percent = {
  discountType: 'percent' as const,
  value: 20,
  maxDiscount: 150,
  minFare: 200,
};
const fixed = {
  discountType: 'fixed' as const,
  value: 100,
  maxDiscount: null,
  minFare: 0,
};

describe('discountFor', () => {
  it('takes a percentage of the fare', () => {
    expect(discountFor(percent, 500)).toBe(100);
  });
  it('caps a percentage at the maximum', () => {
    expect(discountFor(percent, 2000)).toBe(150);
  });
  it('gives nothing below the minimum fare', () => {
    expect(discountFor(percent, 199)).toBe(0);
  });
  it('rounds down to whole rupees', () => {
    expect(discountFor(percent, 333)).toBe(66);
  });
  it('never takes more than the fare', () => {
    expect(discountFor(fixed, 80)).toBe(80);
    expect(discountFor(fixed, 300)).toBe(100);
  });
});

describe('promoProblem', () => {
  const now = new Date('2026-10-27T10:00:00Z');
  const promo = {
    ...percent,
    active: true,
    service: null,
    firstRideOnly: false,
    usageLimit: 100,
    perUserLimit: 1,
    startsAt: null,
    expiresAt: new Date('2026-11-01T00:00:00Z'),
  };
  const use = {
    now,
    service: 'ride',
    totalUses: 0,
    userUses: 0,
    completedTrips: 5,
  };

  it('accepts a fresh code', () => {
    expect(promoProblem(promo, use, 500)).toBeNull();
  });
  it('refuses inactive, not started and expired codes', () => {
    expect(promoProblem({ ...promo, active: false }, use)).toBe(
      'PROMO_INACTIVE',
    );
    expect(
      promoProblem(
        { ...promo, startsAt: new Date('2026-10-28T00:00:00Z') },
        use,
      ),
    ).toBe('PROMO_NOT_STARTED');
    expect(
      promoProblem(promo, { ...use, now: new Date('2026-11-01T00:00:00Z') }),
    ).toBe('PROMO_EXPIRED');
  });
  it('limits per person and in total', () => {
    expect(promoProblem(promo, { ...use, userUses: 1 })).toBe(
      'PROMO_ALREADY_USED',
    );
    expect(promoProblem(promo, { ...use, totalUses: 100 })).toBe(
      'PROMO_USED_UP',
    );
    expect(
      promoProblem(
        { ...promo, usageLimit: null },
        { ...use, totalUses: 10_000 },
      ),
    ).toBeNull();
  });
  it('checks first trip and service', () => {
    expect(promoProblem({ ...promo, firstRideOnly: true }, use)).toBe(
      'PROMO_FIRST_RIDE',
    );
    expect(
      promoProblem(
        { ...promo, firstRideOnly: true },
        { ...use, completedTrips: 0 },
      ),
    ).toBeNull();
    expect(promoProblem({ ...promo, service: 'freight' }, use)).toBe(
      'PROMO_SERVICE',
    );
  });
  it('checks the minimum fare only when a fare is given', () => {
    expect(promoProblem(promo, use, 150)).toBe('PROMO_MIN_FARE');
    expect(promoProblem(promo, use)).toBeNull();
  });
});

describe('normalizeCode', () => {
  it('trims and upper-cases', () => {
    expect(normalizeCode('  fazl20 ')).toBe('FAZL20');
  });
});
