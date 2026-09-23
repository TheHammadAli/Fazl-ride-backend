-- Replaces the fixed VehicleCategory Postgres enum with an admin-manageable
-- table, so a new vehicle type (e.g. "rickshaw") can be added later without a
-- deploy. Written by hand instead of using Prisma's auto-generated diff,
-- which would DROP+ADD the "category" column on vehicles/rides/driver_presence
-- (data loss) - here every column is converted TYPE ... USING ... in place,
-- so existing "bike"/"car" values survive untouched.

-- 1. The new lookup table, seeded with the two categories that exist today.
CREATE TABLE "vehicle_categories" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_categories_pkey" PRIMARY KEY ("key")
);

INSERT INTO "vehicle_categories" ("key", "label", "iconKey", "active", "sortOrder", "updatedAt") VALUES
    ('bike', 'Bike', 'bike', true, 0, CURRENT_TIMESTAMP),
    ('car', 'Car', 'car', true, 1, CURRENT_TIMESTAMP);

-- 2. Convert every column that used the enum to plain text, in place (no
--    DROP COLUMN involved, so the existing 'bike'/'car' values are kept).
ALTER TABLE "vehicles" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "vehicles" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
ALTER TABLE "vehicles" ALTER COLUMN "category" SET DEFAULT 'car';

ALTER TABLE "fare_configs" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

ALTER TABLE "driver_presence" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

ALTER TABLE "rides" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

-- 3. Nothing references the enum type any more - drop it.
DROP TYPE "VehicleCategory";

-- 4. New indexes (driver_presence's "isOnline, category" index already
--    existed on the enum column and survives the TYPE change unchanged).
CREATE INDEX "vehicles_category_idx" ON "vehicles"("category");
CREATE INDEX "rides_category_idx" ON "rides"("category");

-- 5. Foreign keys to the lookup table. Safe now: every existing value is one
--    of the two rows just seeded above (the old enum guaranteed that).
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_fkey" FOREIGN KEY ("category") REFERENCES "vehicle_categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fare_configs" ADD CONSTRAINT "fare_configs_category_fkey" FOREIGN KEY ("category") REFERENCES "vehicle_categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_category_fkey" FOREIGN KEY ("category") REFERENCES "vehicle_categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rides" ADD CONSTRAINT "rides_category_fkey" FOREIGN KEY ("category") REFERENCES "vehicle_categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
