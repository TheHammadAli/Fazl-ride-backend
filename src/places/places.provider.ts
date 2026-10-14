// Place search for the apps (what the passenger types in the search box).
// Screens and other modules only see this; Google is one implementation.

export interface PlaceSuggestion {
  placeId: string;
  /** "Centaurus Mall" */
  title: string;
  /** "Jinnah Avenue, Islamabad" */
  subtitle: string;
}

export interface PlaceDetails {
  placeId: string;
  lat: number;
  lng: number;
  address: string;
}

export interface ReverseResult {
  address: string;
  /** A short name for the spot ("Street 39, E-11"), when there is one. */
  name: string | null;
  city: string | null;
}

export interface Near {
  lat: number;
  lng: number;
}

export abstract class PlacesProvider {
  /** False when no provider is set up (no key): callers fall back. */
  abstract readonly enabled: boolean;

  abstract autocomplete(
    input: string,
    near: Near | null,
    sessionToken: string | null,
  ): Promise<PlaceSuggestion[]>;

  abstract details(
    placeId: string,
    sessionToken: string | null,
  ): Promise<PlaceDetails | null>;

  abstract reverse(point: Near): Promise<ReverseResult | null>;
}
