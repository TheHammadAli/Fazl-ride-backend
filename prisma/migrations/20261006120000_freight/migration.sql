-- AlterTable
ALTER TABLE "vehicle_categories" ADD COLUMN "service" TEXT NOT NULL DEFAULT 'ride';

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "helpersNeeded" INTEGER,
ADD COLUMN     "loadDescription" TEXT,
ADD COLUMN     "loadPhotoKey" TEXT,
ADD COLUMN     "loadWeightKg" INTEGER,
ADD COLUMN     "service" TEXT NOT NULL DEFAULT 'ride';

-- Freight vehicle types. Rates are placeholders for the business to set in
-- the admin panel; the customer and driver agree the actual price.
INSERT INTO "vehicle_categories" ("key", "label", "iconKey", "service", "active", "sortOrder", "createdAt", "updatedAt") VALUES
  ('loader_rickshaw', 'Loader Rickshaw', 'loader_rickshaw', 'freight', true, 20, NOW(), NOW()),
  ('pickup', 'Suzuki Pickup', 'pickup', 'freight', true, 21, NOW(), NOW()),
  ('mini_truck', 'Shehzore / Mazda', 'mini_truck', 'freight', true, 22, NOW(), NOW()),
  ('dumper', 'Dumper / Truck', 'dumper', 'freight', true, 23, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "fare_configs" ("category", "tripType", "baseFare", "perKm", "perMinute", "minimumFare", "updatedAt") VALUES
  ('loader_rickshaw', 'within_city', 300, 40, 2, 400, NOW()),
  ('loader_rickshaw', 'city_to_city', 500, 35, 1, 1500, NOW()),
  ('pickup', 'within_city', 600, 60, 3, 800, NOW()),
  ('pickup', 'city_to_city', 1000, 55, 2, 3000, NOW()),
  ('mini_truck', 'within_city', 1500, 100, 4, 2000, NOW()),
  ('mini_truck', 'city_to_city', 2500, 90, 3, 6000, NOW()),
  ('dumper', 'within_city', 3000, 180, 5, 4000, NOW()),
  ('dumper', 'city_to_city', 5000, 160, 4, 12000, NOW())
ON CONFLICT ("category", "tripType") DO NOTHING;
