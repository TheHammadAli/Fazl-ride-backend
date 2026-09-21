import {
  billedDistanceMeters,
  MAX_LEG_METERS,
  MIN_LEG_METERS,
  tripLeg,
} from './trip-distance.js';

const at = (lat: number, lng: number) => ({ lat, lng });
// 0.001 degrees of latitude is about 111 m.
const A = at(31.5, 74.3);

describe('tripLeg', () => {
  it('adds a normal movement', () => {
    const leg = tripLeg(A, at(31.501, 74.3));
    expect(leg).toBeGreaterThan(100);
    expect(leg).toBeLessThan(120);
  });

  it('ignores GPS jitter below the minimum', () => {
    expect(tripLeg(A, at(31.500_01, 74.3))).toBe(0); // about 1 m
    expect(MIN_LEG_METERS).toBe(5);
  });

  it('ignores an impossible jump', () => {
    expect(tripLeg(A, at(31.6, 74.3))).toBe(0); // about 11 km
    expect(MAX_LEG_METERS).toBe(5000);
  });

  it('ignores a repeated fix', () => {
    expect(tripLeg(A, A)).toBe(0);
  });
});

describe('billedDistanceMeters', () => {
  it('uses the GPS trail when it is longer', () => {
    expect(billedDistanceMeters(8_400, 6_000, 7_000)).toBe(8_400);
  });

  it('never bills less than the straight line pickup -> end', () => {
    expect(billedDistanceMeters(1_000, 6_000, 7_000)).toBe(6_000);
  });

  it('falls back to the estimate when there is no data', () => {
    expect(billedDistanceMeters(0, 0, 7_000)).toBe(7_000);
  });

  it('rounds to whole metres', () => {
    expect(billedDistanceMeters(1_234.6, 0, 9_999)).toBe(1_235);
  });
});
