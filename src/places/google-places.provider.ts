import { Injectable, Logger } from '@nestjs/common';
import {
  parseAutocomplete,
  parseDetails,
  parseReverse,
} from './google-places.js';
import {
  type Near,
  type PlaceDetails,
  type PlaceSuggestion,
  PlacesProvider,
  type ReverseResult,
} from './places.provider.js';

const TIMEOUT_MS = 8000;
// Results lean towards this distance around the person (Google's maximum).
const BIAS_RADIUS_METERS = 50_000;

// Google Places API (New) for search, Geocoding API for naming a point.
// Key: GOOGLE_PLACES_API_KEY (server key, restricted to those two APIs).
@Injectable()
export class GooglePlacesProvider extends PlacesProvider {
  private readonly logger = new Logger(GooglePlacesProvider.name);
  private readonly key = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? '';

  get enabled() {
    return this.key.length > 0;
  }

  async autocomplete(
    input: string,
    near: Near | null,
    sessionToken: string | null,
  ): Promise<PlaceSuggestion[]> {
    const body = await this.call(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input,
          includedRegionCodes: ['pk'],
          languageCode: 'en',
          ...(sessionToken && { sessionToken }),
          ...(near && {
            origin: { latitude: near.lat, longitude: near.lng },
            locationBias: {
              circle: {
                center: { latitude: near.lat, longitude: near.lng },
                radius: BIAS_RADIUS_METERS,
              },
            },
          }),
        }),
      },
    );
    return parseAutocomplete(body);
  }

  async details(
    placeId: string,
    sessionToken: string | null,
  ): Promise<PlaceDetails | null> {
    const url = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    );
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
    // Only "Essentials" fields, the cheapest kind of details request.
    const body = await this.call(url.toString(), {
      headers: { 'X-Goog-FieldMask': 'id,formattedAddress,location' },
    });
    return parseDetails(placeId, body);
  }

  async reverse(point: Near): Promise<ReverseResult | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${point.lat},${point.lng}`);
    url.searchParams.set('language', 'en');
    url.searchParams.set('key', this.key);
    const body = (await this.call(url.toString(), {})) as {
      status?: string;
      error_message?: string;
    };
    if (body.status && !['OK', 'ZERO_RESULTS'].includes(body.status)) {
      throw new Error(`Geocoding: ${body.status} ${body.error_message ?? ''}`);
    }
    return parseReverse(body);
  }

  private async call(url: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('X-Goog-Api-Key', this.key);
    const res = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        res.statusText;
      this.logger.warn(`Google ${res.status}: ${message}`);
      throw new Error(`Google ${res.status}`);
    }
    return body;
  }
}
