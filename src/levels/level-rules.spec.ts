import { describe, expect, it } from 'vitest';
import {
  byPriority,
  discountedPercent,
  levelFor,
  newlyReached,
  nextLevel,
  progress,
} from './level-rules.js';

const levels = [
  { key: 'gold', name: 'Gold', minRides: 1000, active: true },
  { key: 'silver', name: 'Silver', minRides: 500, active: true },
  { key: 'platinum', name: 'Platinum', minRides: 3000, active: true },
  { key: 'diamond', name: 'Diamond', minRides: 5000, active: false },
];

describe('levels', () => {
  it('finds the level reached and the next one', () => {
    expect(levelFor(499, levels)).toBeNull();
    expect(levelFor(500, levels)?.key).toBe('silver');
    expect(levelFor(2999, levels)?.key).toBe('gold');
    expect(levelFor(99999, levels)?.key).toBe('platinum');
    expect(nextLevel(742, levels)?.key).toBe('gold');
    expect(nextLevel(3000, levels)).toBeNull();
  });

  it('shows progress to the next level', () => {
    const p = progress(742, levelFor(742, levels), nextLevel(742, levels));
    expect(p).toEqual({ from: 500, to: 1000, left: 258, fraction: 0.484 });
    expect(progress(10, null, nextLevel(10, levels)).left).toBe(490);
    expect(progress(4000, levelFor(4000, levels), null).fraction).toBe(1);
  });

  it('lists every level newly reached, once', () => {
    expect(newlyReached(null, 1200, levels).map((l) => l.key)).toEqual([
      'silver',
      'gold',
    ]);
    expect(newlyReached('silver', 1000, levels).map((l) => l.key)).toEqual([
      'gold',
    ]);
    expect(newlyReached('gold', 1001, levels)).toEqual([]);
    // Diamond was reached, then turned off: Platinum is not "new".
    expect(newlyReached('diamond', 5200, levels)).toEqual([]);
  });

  it('takes the discount off the commission, not below zero', () => {
    expect(discountedPercent(10, 2)).toBe(8);
    expect(discountedPercent(1, 3)).toBe(0);
  });

  it('lets priority count as metres closer', () => {
    const drivers = [
      { userId: 'a', distanceMeters: 800 },
      { userId: 'b', distanceMeters: 1200 },
    ];
    expect(byPriority(drivers, new Map()).map((d) => d.userId)).toEqual([
      'a',
      'b',
    ]);
    expect(
      byPriority(drivers, new Map([['b', 500]])).map((d) => d.userId),
    ).toEqual(['b', 'a']);
  });
});
