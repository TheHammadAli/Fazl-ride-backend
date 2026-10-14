import type {
  PlaceDetails,
  PlaceSuggestion,
  ReverseResult,
} from './places.provider.js';

// Pure parsing of Google's answers, kept apart so it can be tested without
// calling Google.

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }[];
}

/** Places API (New) `places:autocomplete` -> suggestions (places only). */
export function parseAutocomplete(body: unknown): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  for (const s of (body as AutocompleteResponse)?.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const title = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
    if (!title) continue;
    out.push({
      placeId: p.placeId,
      title,
      subtitle: p.structuredFormat?.secondaryText?.text ?? '',
    });
  }
  return out;
}

interface DetailsResponse {
  id?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

/** Places API (New) `places/{id}` (id, formattedAddress, location). */
export function parseDetails(
  placeId: string,
  body: unknown,
): PlaceDetails | null {
  const b = body as DetailsResponse;
  const lat = b?.location?.latitude;
  const lng = b?.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { placeId, lat, lng, address: b.formattedAddress ?? '' };
}

interface GeocodeComponent {
  long_name: string;
  types: string[];
}
interface GeocodeResponse {
  status?: string;
  results?: {
    formatted_address?: string;
    types?: string[];
    address_components?: GeocodeComponent[];
  }[];
}

// "M3V8+G3G" / "G85R+XM6": Google's plus codes mean nothing to a driver.
const PLUS_CODE =
  /\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b[,\s]*/gi;

/**
 * Geocoding API reverse lookup -> address, a short name and the city. Takes
 * the nearest result that is not just a plus code and strips plus codes out
 * of its text. Pakistani sectors and blocks ("F-8", "Gulberg III") come as
 * plain "political" parts.
 */
export function parseReverse(body: unknown): ReverseResult | null {
  const results = (body as GeocodeResponse)?.results ?? [];
  const best = results.find(
    (r) => r.formatted_address && !(r.types ?? []).includes('plus_code'),
  );
  const address = best?.formatted_address?.replace(PLUS_CODE, '').trim();
  if (!best || !address) return null;
  const parts = (best.address_components ?? []).filter(
    (p) => !p.types.includes('plus_code'),
  );
  const pick = (test: (types: string[]) => boolean) =>
    parts.find((p) => test(p.types))?.long_name ?? null;
  const has =
    (...types: string[]) =>
    (t: string[]) =>
      types.some((x) => t.includes(x));
  const city =
    pick(has('locality')) ?? pick(has('administrative_area_level_2'));
  const spot = pick(has('point_of_interest', 'establishment', 'premise'));
  const road = pick(has('route'));
  const area =
    pick(has('sublocality_level_1', 'sublocality', 'neighborhood')) ??
    pick((t) => t.length === 1 && t[0] === 'political');
  const name = spot
    ? [spot, area].filter(Boolean).join(', ')
    : road
      ? [road, area ?? city].filter(Boolean).join(', ')
      : area
        ? [area, city].filter(Boolean).join(', ')
        : null;
  return { address, name, city };
}
