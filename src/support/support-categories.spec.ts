import { describe, expect, it } from 'vitest';
import {
  categoryByKey,
  SUPPORT_CATEGORIES,
  ticketCode,
} from './support-categories.js';

describe('support categories', () => {
  it('has unique keys, each for someone', () => {
    const keys = SUPPORT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of SUPPORT_CATEGORIES) expect(c.for.length).toBeGreaterThan(0);
  });

  it('safety is urgent and about the other person', () => {
    expect(categoryByKey('safety')).toMatchObject({
      priority: 'urgent',
      aboutOther: true,
      needsRide: true,
    });
  });

  it('something else is always possible without a ride', () => {
    expect(categoryByKey('other')).toMatchObject({ needsRide: false });
    expect(categoryByKey('other')?.for).toEqual(['passenger', 'driver']);
  });

  it('writes ticket numbers as FZ-000123', () => {
    expect(ticketCode(123)).toBe('FZ-000123');
    expect(ticketCode(1234567)).toBe('FZ-1234567');
  });
});
