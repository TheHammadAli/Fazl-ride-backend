import { describe, expect, it } from 'vitest';
import {
  parseAutocomplete,
  parseDetails,
  parseReverse,
} from './google-places.js';
import { TtlCache } from './ttl-cache.js';

describe('parseAutocomplete', () => {
  it('keeps places with a title and splits main and secondary text', () => {
    expect(
      parseAutocomplete({
        suggestions: [
          {
            placePrediction: {
              placeId: 'p1',
              text: { text: 'Centaurus Mall, Jinnah Avenue, Islamabad' },
              structuredFormat: {
                mainText: { text: 'Centaurus Mall' },
                secondaryText: { text: 'Jinnah Avenue, Islamabad' },
              },
            },
          },
          { queryPrediction: { text: { text: 'malls near me' } } },
          { placePrediction: { placeId: 'p2', text: { text: 'F-6' } } },
          { placePrediction: { text: { text: 'no id' } } },
        ],
      }),
    ).toEqual([
      {
        placeId: 'p1',
        title: 'Centaurus Mall',
        subtitle: 'Jinnah Avenue, Islamabad',
      },
      { placeId: 'p2', title: 'F-6', subtitle: '' },
    ]);
  });

  it('copes with an empty answer', () => {
    expect(parseAutocomplete({})).toEqual([]);
    expect(parseAutocomplete(null)).toEqual([]);
  });
});

describe('parseDetails', () => {
  it('reads the position and address', () => {
    expect(
      parseDetails('p1', {
        formattedAddress: 'Jinnah Ave, F-8/4, Islamabad',
        location: { latitude: 33.7077, longitude: 73.0501 },
      }),
    ).toEqual({
      placeId: 'p1',
      lat: 33.7077,
      lng: 73.0501,
      address: 'Jinnah Ave, F-8/4, Islamabad',
    });
  });

  it('is null without a position', () => {
    expect(parseDetails('p1', { formattedAddress: 'x' })).toBeNull();
  });
});

describe('parseReverse', () => {
  const c = (long_name: string, ...types: string[]) => ({ long_name, types });

  it('skips plus codes and names the street and sector', () => {
    expect(
      parseReverse({
        status: 'OK',
        results: [
          { formatted_address: '8J5V+XX Islamabad', types: ['plus_code'] },
          {
            formatted_address: 'Street 39, E-11/2, Islamabad, Pakistan',
            types: ['street_address'],
            address_components: [
              c('Street 39', 'route'),
              c('E-11/2', 'sublocality_level_1', 'sublocality'),
              c('Islamabad', 'locality'),
            ],
          },
        ],
      }),
    ).toEqual({
      address: 'Street 39, E-11/2, Islamabad, Pakistan',
      name: 'Street 39, E-11/2',
      city: 'Islamabad',
    });
  });

  it('prefers a named place', () => {
    expect(
      parseReverse({
        results: [
          {
            formatted_address: 'Liberty Market, Gulberg III, Lahore',
            address_components: [
              c('Liberty Market', 'point_of_interest', 'establishment'),
              c('Gulberg III', 'sublocality_level_1'),
              c('Lahore', 'locality'),
            ],
          },
        ],
      })?.name,
    ).toBe('Liberty Market, Gulberg III');
  });

  it('strips a plus code and uses a political sector', () => {
    expect(
      parseReverse({
        results: [
          {
            formatted_address: 'P25X+3WG, F 8/4 F-8, Islamabad, Pakistan',
            types: ['establishment', 'point_of_interest'],
            address_components: [
              c('P25X+3WG', 'plus_code'),
              c('F 8/4', 'political'),
              c('F-8', 'political'),
              c('Islamabad', 'locality', 'political'),
            ],
          },
        ],
      }),
    ).toEqual({
      address: 'F 8/4 F-8, Islamabad, Pakistan',
      name: 'F 8/4, Islamabad',
      city: 'Islamabad',
    });
  });

  it('names a road with its city when there is no area', () => {
    const r = parseReverse({
      results: [
        {
          formatted_address: 'M3V8+G3G, Srinagar Hwy, Islamabad, Pakistan',
          address_components: [
            c('M3V8+G3G', 'plus_code'),
            c('Srinagar Highway', 'route'),
            c('Islamabad', 'locality', 'political'),
          ],
        },
      ],
    });
    expect(r?.address).toBe('Srinagar Hwy, Islamabad, Pakistan');
    expect(r?.name).toBe('Srinagar Highway, Islamabad');
  });

  it('is null when nothing is known', () => {
    expect(parseReverse({ status: 'ZERO_RESULTS', results: [] })).toBeNull();
  });
});

describe('TtlCache', () => {
  it('drops the oldest entry past the size cap', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('forgets entries after their time', () => {
    const cache = new TtlCache<number>(-1, 10);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
  });
});
