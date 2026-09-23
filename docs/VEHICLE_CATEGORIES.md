# Vehicle categories

What a passenger can choose (bike, car, ...) is an admin-managed table
(`vehicle_categories`), not a fixed list in code. An admin can add a new
category - e.g. "rickshaw" - without a deploy, and it immediately shows up in
`POST rides/estimate`, `GET vehicle-categories`, and the driver's vehicle-type
choice, since every one of those already lists whatever is in the table.

Before 2026-09-23 this was a Postgres enum (`VehicleCategory`) wired directly
into `vehicles`, `rides`, `driver_presence` and `fare_configs` (its primary
key); adding "rickshaw" needed a migration each time. Migration
`20260923104559_vehicle_categories_table` converted all four columns to plain
`text` with a foreign key to the new table, keeping every existing `bike`/
`car` value untouched.

## What a category is

| Field | Meaning |
|---|---|
| `key` | Stable id, e.g. `"bike"`, `"rickshaw"`. Lowercase letters/digits/underscores, 2-30 chars. This is what's stored on vehicles/rides/driver_presence and sent in the API. |
| `label` | What people see, e.g. `"Bike"`. |
| `iconKey` | Which icon the client apps draw - **must be one of `KNOWN_VEHICLE_ICON_KEYS`** (`src/vehicle-categories/vehicle-icons.ts`): `bike`, `car`, `rickshaw`, `van`, `truck`, `suv`. A category with an icon outside this list is refused at creation, so the apps never have to guess - they can always render every category they're shown. Adding a genuinely new-looking vehicle still needs an app update to teach it a new icon; add the key here first. |
| `active` | Whether it can be booked/registered right now. Deactivating (never deleting - other tables reference the row) removes it from estimates and refuses new rides/vehicles in that category, but past rides/vehicles keep it. |
| `sortOrder` | Display order (lowest first). |

Every category needs a matching row in `fare_configs` (base fare, per-km, per-minute, minimum fare) - a category with no fare row could never actually be priced, so `POST admin/vehicle-categories` creates both together in one transaction.

## Endpoints

- `GET /vehicle-categories` (any signed-in user) - active categories only, for a passenger's "choose a ride" list or a driver's vehicle-type picker.
- `GET /admin/vehicle-categories` (admin/super_admin) - every category, including inactive ones.
- `POST /admin/vehicle-categories` (admin/super_admin) - create one, with its starting fares:
  ```json
  {
    "key": "rickshaw",
    "label": "Rickshaw",
    "iconKey": "rickshaw",
    "sortOrder": 2,
    "fare": { "baseFare": 40, "perKm": 12, "perMinute": 1.5, "minimumFare": 70 }
  }
  ```
- `PATCH /admin/vehicle-categories/:key` (admin/super_admin) - edit `label`/`iconKey`/`active`/`sortOrder`. Fares are edited separately, unchanged: `PUT admin/fares/:category`.

`VehicleCategoriesService` (`src/vehicle-categories/`) is the one place that reads/writes the table; it caches the active list for 30 seconds (categories change rarely) and is what `RidesService.request()` and `DriversService.apply()/addVehicle()` call to reject an unknown or deactivated category with a clean 400 instead of a foreign-key error.

## What still needs a code change

Nothing on the backend - a brand new category works end to end (bookable, priced, matched) the moment it's created, as long as its `iconKey` is one already in `KNOWN_VEHICLE_ICON_KEYS`. Adding a **new icon** (a vehicle look the apps have never drawn before) means: add the key to `KNOWN_VEHICLE_ICON_KEYS` here, and add the matching icon to each client app's own icon map, before creating a category that uses it.
