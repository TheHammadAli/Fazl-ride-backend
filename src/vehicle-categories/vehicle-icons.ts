// The only icons the client apps currently know how to draw. A category
// created with an iconKey outside this list is refused by CreateVehicleCategoryDto
// - keep this list and each client's own icon map in sync when an app learns
// to draw a new one. See docs/VEHICLE_CATEGORIES.md.
export const KNOWN_VEHICLE_ICON_KEYS = [
  'bike',
  'car',
  'rickshaw',
  'van',
  'truck',
  'suv',
] as const;
