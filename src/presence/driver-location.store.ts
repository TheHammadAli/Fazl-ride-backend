import type { LatLng } from '../common/geo.js';

export interface NearbyDriver {
  userId: string;
  vehicleId: string;
  // The vehicle's own type (car), and every ride type it can be offered.
  category: string;
  categories: string[];
  distanceMeters: number;
  lat: number;
  lng: number;
  heading: number | null;
}

export interface DriverPosition {
  lat: number;
  lng: number;
  heading: number | null;
  updatedAt: Date;
}

export interface NearbyQuery extends LatLng {
  radiusMeters: number;
  limit: number;
  category?: string;
}

// Where live driver positions are kept and searched. PostGIS today; a Redis
// GEO implementation can replace it without touching ride logic.
export abstract class DriverLocationStore {
  abstract goOnline(
    userId: string,
    vehicleId: string,
    category: string,
    categories: string[],
    at: LatLng,
  ): Promise<void>;
  abstract goOffline(userId: string): Promise<void>;
  abstract updateLocation(
    userId: string,
    at: LatLng,
    extra: { heading?: number; speedKmh?: number },
  ): Promise<void>;
  abstract setBusy(userId: string, busy: boolean): Promise<void>;
  abstract findNearby(query: NearbyQuery): Promise<NearbyDriver[]>;
  abstract getLocation(userId: string): Promise<DriverPosition | null>;
}
