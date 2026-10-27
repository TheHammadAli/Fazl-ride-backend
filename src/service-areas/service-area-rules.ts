// Where FAZL runs: each service city is a centre and a radius. Pure maths so
// it can be tested without a database.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CityArea extends LatLng {
  id: string;
  name: string;
  radiusKm: number;
  active: boolean;
}

const EARTH_KM = 6371;

export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// The nearest active city whose circle holds the point, or null.
export function cityFor<T extends CityArea>(
  point: LatLng,
  cities: readonly T[],
): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const city of cities) {
    if (!city.active) continue;
    const km = distanceKm(point, city);
    if (km <= city.radiusKm && km < bestKm) {
      best = city;
      bestKm = km;
    }
  }
  return best;
}
