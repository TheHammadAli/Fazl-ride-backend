import { describe, expect, it } from 'vitest';
import { cityFor, distanceKm } from './service-area-rules.js';

const islamabad = {
  id: 'isb',
  name: 'Islamabad',
  lat: 33.6844,
  lng: 73.0479,
  radiusKm: 25,
  active: true,
};
const rawalpindi = {
  id: 'rwp',
  name: 'Rawalpindi',
  lat: 33.5651,
  lng: 73.0169,
  radiusKm: 20,
  active: true,
};
const lahore = {
  id: 'lhr',
  name: 'Lahore',
  lat: 31.5204,
  lng: 74.3587,
  radiusKm: 30,
  active: false,
};

describe('distanceKm', () => {
  it('measures Islamabad to Lahore at about 270 km', () => {
    const km = distanceKm(islamabad, lahore);
    expect(km).toBeGreaterThan(260);
    expect(km).toBeLessThan(280);
  });
});

describe('cityFor', () => {
  const cities = [islamabad, rawalpindi, lahore];

  it('finds the city a point is in', () => {
    expect(cityFor({ lat: 33.71, lng: 73.06 }, cities)?.id).toBe('isb');
  });

  it('picks the nearer centre where two circles overlap', () => {
    // Saddar, Rawalpindi: inside both circles, nearer Rawalpindi.
    expect(cityFor({ lat: 33.5973, lng: 73.0479 }, cities)?.id).toBe('rwp');
  });

  it('ignores inactive cities', () => {
    expect(cityFor({ lat: 31.52, lng: 74.35 }, cities)).toBeNull();
  });

  it('returns null outside every circle', () => {
    expect(cityFor({ lat: 34.0, lng: 71.5 }, cities)).toBeNull();
  });
});
