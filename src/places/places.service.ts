import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type Near,
  type PlaceDetails,
  type PlaceSuggestion,
  PlacesProvider,
  type ReverseResult,
} from './places.provider.js';
import { TtlCache } from './ttl-cache.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Search answers are reused for a while (the same words near the same spot),
// a place's position for up to 30 days (what Google allows to be kept).
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly suggestions = new TtlCache<PlaceSuggestion[]>(
    10 * MINUTE,
    2000,
  );
  private readonly places = new TtlCache<PlaceDetails>(30 * DAY, 5000);
  private readonly points = new TtlCache<ReverseResult | null>(DAY, 5000);

  constructor(private readonly provider: PlacesProvider) {}

  autocomplete(input: string, near: Near | null, session: string | null) {
    const q = input.trim().replace(/\s+/g, ' ');
    // ~1 km cells: answers for the same words close by are the same.
    const cell = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '-';
    return this.cached(this.suggestions, `${q.toLowerCase()}|${cell}`, () =>
      this.provider.autocomplete(q, near, session),
    );
  }

  async details(placeId: string, session: string | null) {
    const place = await this.cached(this.places, placeId, () =>
      this.provider.details(placeId, session),
    );
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  reverse(point: Near) {
    // ~11 m cells.
    const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    return this.cached(this.points, key, () => this.provider.reverse(point));
  }

  private async cached<V>(
    cache: TtlCache<V>,
    key: string,
    load: () => Promise<V>,
  ): Promise<V> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (!this.provider.enabled) throw unavailable();
    let value: V;
    try {
      value = await load();
    } catch (err) {
      this.logger.warn(`Place lookup failed: ${(err as Error).message}`);
      throw unavailable();
    }
    if (value !== null) cache.set(key, value);
    return value;
  }
}

// The apps fall back to their own (OpenStreetMap) search on this code.
function unavailable() {
  return new ServiceUnavailableException({
    message: 'Place search is not available right now',
    code: 'PLACES_UNAVAILABLE',
  });
}
