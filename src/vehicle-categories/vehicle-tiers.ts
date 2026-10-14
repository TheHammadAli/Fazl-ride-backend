// Ride tiers (Mini, Economy, AC, Business...): which ride types a vehicle
// can be offered, and which tiers it looks good for. No database here.

export interface TierCategory {
  key: string;
  parentKey: string | null;
  active: boolean;
  requiresAc: boolean;
  minYear: number | null;
  models: string[];
}

export interface TierVehicle {
  category: string;
  make: string;
  model: string;
  year: number;
  hasAc: boolean;
  tiers: string[];
  tiersOff: string[];
}

// A tier anyone of its base type may serve: no requirement at all.
export function isOpenTier(c: TierCategory): boolean {
  return !c.requiresAc && c.minYear == null && c.models.length === 0;
}

// Does the vehicle meet a tier's requirements (what the admin is suggested)?
export function meetsTier(c: TierCategory, v: TierVehicle): boolean {
  if (c.requiresAc && !v.hasAc) return false;
  if (c.minYear != null && v.year < c.minYear) return false;
  if (c.models.length) {
    const name = `${v.make} ${v.model}`.toLowerCase();
    if (!c.models.some((m) => name.includes(m.toLowerCase()))) return false;
  }
  return true;
}

export function tiersOf<T extends TierCategory>(
  base: string,
  categories: T[],
): T[] {
  return categories.filter((c) => c.parentKey === base && c.active);
}

// Tiers with requirements the vehicle meets: ticked for the admin on approval.
export function suggestTiers(
  v: TierVehicle,
  categories: TierCategory[],
): string[] {
  return tiersOf(v.category, categories)
    .filter((c) => !isOpenTier(c) && meetsTier(c, v))
    .map((c) => c.key);
}

// Every ride type the vehicle can be offered: its own type, open tiers of
// that type, and tiers an admin approved it for, minus what the driver
// switched off. Never empty: with everything off it keeps its own type.
export function servingCategories(
  v: TierVehicle,
  categories: TierCategory[],
): string[] {
  const tiers = tiersOf(v.category, categories);
  const serving = [
    v.category,
    ...tiers
      .filter((c) => isOpenTier(c) || v.tiers.includes(c.key))
      .map((c) => c.key),
  ];
  const on = serving.filter((k) => !v.tiersOff.includes(k));
  return on.length ? [...new Set(on)] : [v.category];
}
