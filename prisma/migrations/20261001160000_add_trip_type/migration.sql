-- Adds a within_city / city_to_city distinction to rides, so the same
-- request/match/accept/complete flow can price a long intercity trip
-- differently without touching matching (a driver is still found near the
-- pickup point regardless of how far the drop-off is).

CREATE TYPE "TripType" AS ENUM ('within_city', 'city_to_city');

-- fare_configs: one rate card per (category, tripType) instead of per
-- category alone. Every existing row becomes a "within_city" row untouched.
ALTER TABLE "fare_configs" ADD COLUMN "tripType" "TripType" NOT NULL DEFAULT 'within_city';
ALTER TABLE "fare_configs" DROP CONSTRAINT "fare_configs_pkey";
ALTER TABLE "fare_configs" ADD CONSTRAINT "fare_configs_pkey" PRIMARY KEY ("category", "tripType");

-- rides: which kind of trip this was, defaulting existing rows to within_city.
ALTER TABLE "rides" ADD COLUMN "tripType" "TripType" NOT NULL DEFAULT 'within_city';
CREATE INDEX "rides_tripType_idx" ON "rides"("tripType");

-- Seed a placeholder city_to_city rate card for "car" only (the only category
-- that makes sense for long intercity trips today); the business will set the
-- real numbers through PUT admin/fares/car/city_to_city. "bike" gets no
-- city_to_city row, so it simply is not offered for that trip type yet
-- (FaresService only lists categories that have a fare_config row).
INSERT INTO "fare_configs" ("category", "tripType", "baseFare", "perKm", "perMinute", "minimumFare", "updatedAt")
VALUES ('car', 'city_to_city', 2000, 22, 1, 3000, CURRENT_TIMESTAMP);
