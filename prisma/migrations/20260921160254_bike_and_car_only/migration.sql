-- Only two vehicle types are offered in Pakistan: bike and car.
-- The old economy fare becomes the car fare; comfort and xl are dropped; bike is new.
DELETE FROM "fare_configs" WHERE "category" IN ('comfort', 'xl');

CREATE TYPE "VehicleCategory_new" AS ENUM ('bike', 'car');

ALTER TABLE "vehicles" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "vehicles" ALTER COLUMN "category" TYPE "VehicleCategory_new" USING ('car'::"VehicleCategory_new");
ALTER TABLE "vehicles" ALTER COLUMN "category" SET DEFAULT 'car';
ALTER TABLE "fare_configs" ALTER COLUMN "category" TYPE "VehicleCategory_new" USING ('car'::"VehicleCategory_new");
ALTER TABLE "rides" ALTER COLUMN "category" TYPE "VehicleCategory_new" USING ('car'::"VehicleCategory_new");
ALTER TABLE "driver_presence" ALTER COLUMN "category" TYPE "VehicleCategory_new" USING ('car'::"VehicleCategory_new");

DROP TYPE "VehicleCategory";
ALTER TYPE "VehicleCategory_new" RENAME TO "VehicleCategory";

-- Placeholder rates (a bike costs less than a car). The business must set the real ones.
INSERT INTO "fare_configs" ("category", "baseFare", "perKm", "perMinute", "minimumFare", "updatedAt")
VALUES ('bike', 60, 18, 2, 100, CURRENT_TIMESTAMP)
ON CONFLICT ("category") DO NOTHING;
