import { HaversineRoutingProvider } from './haversine-routing.provider.js';
import {
  DEFAULT_SPEED_KMH,
  nextAverageSpeed,
  travelSpeedKmh,
} from './travel-speed.js';

describe('nextAverageSpeed', () => {
  it('starts from the first reading while moving', () => {
    expect(nextAverageSpeed(null, 40)).toBe(40);
  });

  it('leaves standing still out, so a red light does not slow the average', () => {
    expect(nextAverageSpeed(40, 0)).toBe(40);
    expect(nextAverageSpeed(40, 3)).toBe(40);
    expect(nextAverageSpeed(null, 2)).toBeNull();
  });

  it('keeps the average when the phone sends no speed', () => {
    expect(nextAverageSpeed(40, undefined)).toBe(40);
    expect(nextAverageSpeed(undefined, null)).toBeNull();
  });

  it('follows the driving a little at a time', () => {
    const after = nextAverageSpeed(40, 60)!;
    expect(after).toBeGreaterThan(40);
    expect(after).toBeLessThan(45);

    // A minute of steady 60 km/h (a reading every 2-4 s) brings it there.
    let average: number | null = 20;
    for (let i = 0; i < 30; i++) average = nextAverageSpeed(average, 60);
    expect(average).toBeGreaterThan(55);
  });

  it('a GPS jump can not give an absurd speed', () => {
    expect(nextAverageSpeed(null, 290)).toBe(100);
  });
});

describe('travelSpeedKmh', () => {
  it('is the mean of the drivers known', () => {
    expect(travelSpeedKmh([30, 40, null])).toBe(35);
  });

  it('falls back to the default when nobody has driven yet', () => {
    expect(travelSpeedKmh([])).toBe(DEFAULT_SPEED_KMH);
    expect(travelSpeedKmh([null, undefined])).toBe(DEFAULT_SPEED_KMH);
  });
});

describe('HaversineRoutingProvider', () => {
  const routing = new HaversineRoutingProvider();
  // About 19 km of road between two points 14 km apart.
  const from = { lat: 32.93, lng: 72.85 };
  const to = { lat: 33.056, lng: 72.85 };

  it('times the same road by how fast the vehicle goes', async () => {
    const bike = await routing.route(from, to, 30);
    const car = await routing.route(from, to, 45);
    expect(bike.distanceMeters).toBe(car.distanceMeters);
    expect(Math.round(bike.distanceMeters / 1000)).toBe(19);
    expect(Math.round(bike.durationSeconds / 60)).toBe(38); // 19 km at 30
    expect(Math.round(car.durationSeconds / 60)).toBe(25); // 19 km at 45
  });

  it('uses the default speed when none is known', async () => {
    const plain = await routing.route(from, to);
    const atDefault = await routing.route(from, to, DEFAULT_SPEED_KMH);
    expect(plain).toEqual(atDefault);
  });
});
