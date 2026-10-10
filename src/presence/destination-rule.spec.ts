import { takesTowardsDestination } from './destination-rule.js';

// Islamabad (F-8), Murree and places around them.
const islamabad = { lat: 33.7099, lng: 73.0379 };
const murree = { lat: 33.9076, lng: 73.3943 };
const bharaKahu = { lat: 33.7316, lng: 73.1878 };
const murreeMallRoad = { lat: 33.9046, lng: 73.3911 };
const nathiaGali = { lat: 34.0729, lng: 73.3824 };
const rawalpindi = { lat: 33.5651, lng: 73.0169 };
const faizabad = { lat: 33.6633, lng: 73.0838 };

describe('takesTowardsDestination', () => {
  it('takes a ride from Murree down to Bhara Kahu (on the way home)', () => {
    expect(takesTowardsDestination(murree, murree, bharaKahu, islamabad)).toBe(
      true,
    );
  });

  it('skips a ride inside Murree', () => {
    expect(
      takesTowardsDestination(murree, murree, murreeMallRoad, islamabad),
    ).toBe(false);
  });

  it('skips a ride the other way (Nathia Gali)', () => {
    expect(takesTowardsDestination(murree, murree, nathiaGali, islamabad)).toBe(
      false,
    );
  });

  it('takes a ride that ends close to the destination', () => {
    expect(takesTowardsDestination(murree, murree, faizabad, islamabad)).toBe(
      true,
    );
  });

  it('skips a ride that goes well past it (Rawalpindi)', () => {
    expect(takesTowardsDestination(murree, murree, rawalpindi, islamabad)).toBe(
      false,
    );
  });

  it('skips a pickup far off the way', () => {
    expect(
      takesTowardsDestination(murree, nathiaGali, bharaKahu, islamabad),
    ).toBe(false);
  });
});
