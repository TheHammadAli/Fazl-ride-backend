import type { LatLng } from '../common/geo.js';
import { VehicleCategory } from '../generated/prisma/enums.js';

export interface NearbyDriver {
  userId: string;
  vehicleId: string;
  category: VehicleCategory;
  distanceMeters: number;
  lat: number;
  lng: number;
  heading: number | null;
}

export interface NearbyQuery extends LatLng {
  radiusMeters: number;
  limit: number;
  category?: VehicleCategory;
}

// Where live driver positions are kept and searched. PostGIS today; a Redis
// GEO implementation can replace it without touching ride logic.
export abstract class DriverLocationStore {
  abstract goOnline(
    userId: string,
    vehicleId: string,
    category: VehicleCategory,
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
}
