import { haversineMeters } from './geo.js';

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(
      haversineMeters({ lat: 31.52, lng: 74.35 }, { lat: 31.52, lng: 74.35 }),
    ).toBe(0);
  });

  it('matches a known distance (Lahore -> Islamabad is about 270 km straight line)', () => {
    const km =
      haversineMeters(
        { lat: 31.5204, lng: 74.3587 },
        { lat: 33.6844, lng: 73.0479 },
      ) / 1000;
    expect(km).toBeGreaterThan(260);
    expect(km).toBeLessThan(285);
  });

  it('is symmetric', () => {
    const a = { lat: 24.8607, lng: 67.0011 };
    const b = { lat: 24.9, lng: 67.1 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});
