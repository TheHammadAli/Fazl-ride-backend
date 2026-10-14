import { describe, expect, it } from 'vitest';
import {
  isOpenTier,
  servingCategories,
  suggestTiers,
  type TierCategory,
  type TierVehicle,
} from './vehicle-tiers.js';

const tier = (
  key: string,
  extra: Partial<TierCategory> = {},
): TierCategory => ({
  key,
  parentKey: 'car',
  active: true,
  requiresAc: false,
  minYear: null,
  models: [],
  ...extra,
});

const categories: TierCategory[] = [
  {
    key: 'car',
    parentKey: null,
    active: true,
    requiresAc: false,
    minYear: null,
    models: [],
  },
  tier('car_mini'),
  tier('car_ac', { requiresAc: true }),
  tier('car_business', {
    requiresAc: true,
    minYear: 2018,
    models: ['corolla', 'civic', 'sportage'],
  }),
  tier('car_old', { active: false }),
];

const car = (extra: Partial<TierVehicle> = {}): TierVehicle => ({
  category: 'car',
  make: 'Suzuki',
  model: 'Cultus',
  year: 2016,
  hasAc: false,
  tiers: [],
  tiersOff: [],
  ...extra,
});

describe('tiers', () => {
  it('a tier with no requirement is open', () => {
    expect(isOpenTier(categories[1])).toBe(true);
    expect(isOpenTier(categories[2])).toBe(false);
  });

  it('any car serves its own type and open tiers (Economy takes Mini)', () => {
    expect(servingCategories(car(), categories)).toEqual(['car', 'car_mini']);
  });

  it('approved tiers are added, inactive ones never', () => {
    expect(
      servingCategories(car({ tiers: ['car_ac', 'car_old'] }), categories),
    ).toEqual(['car', 'car_mini', 'car_ac']);
  });

  it('the driver can switch tiers off, but keeps at least one', () => {
    const v = car({ tiers: ['car_ac'], tiersOff: ['car_mini'] });
    expect(servingCategories(v, categories)).toEqual(['car', 'car_ac']);
    expect(
      servingCategories(car({ tiersOff: ['car', 'car_mini'] }), categories),
    ).toEqual(['car']);
  });

  it('suggests tiers the car meets', () => {
    expect(suggestTiers(car(), categories)).toEqual([]);
    expect(suggestTiers(car({ hasAc: true }), categories)).toEqual(['car_ac']);
    expect(
      suggestTiers(
        car({
          make: 'Toyota',
          model: 'Corolla Altis',
          year: 2020,
          hasAc: true,
        }),
        categories,
      ),
    ).toEqual(['car_ac', 'car_business']);
    // Too old for Business.
    expect(
      suggestTiers(
        car({ make: 'Toyota', model: 'Corolla', year: 2012, hasAc: true }),
        categories,
      ),
    ).toEqual(['car_ac']);
  });
});
