import { calculateFare } from './fare.calculator.js';

const economy = {
  baseFare: 100,
  perKm: 30,
  perMinute: 3,
  minimumFare: 150,
  cancellationFee: 100,
};

describe('calculateFare', () => {
  it('adds base, distance and time', () => {
    // 100 + 30*10 + 3*20 = 460
    expect(calculateFare(economy, 10_000, 20 * 60)).toBe(460);
  });

  it('never goes below the minimum fare', () => {
    expect(calculateFare(economy, 200, 60)).toBe(150);
  });

  it('rounds to whole rupees', () => {
    // 100 + 30*1.234 + 3*1.5 = 141.52 -> below minimum, so use a bigger case
    expect(calculateFare({ ...economy, minimumFare: 0 }, 1_234, 90)).toBe(142);
  });

  it('supports fractional rates', () => {
    expect(
      calculateFare({ ...economy, perKm: 32.5, minimumFare: 0 }, 4_000, 0),
    ).toBe(230);
  });
});
