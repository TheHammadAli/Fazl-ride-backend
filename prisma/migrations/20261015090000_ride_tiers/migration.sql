-- Ride tiers (Mini, Economy, AC, Business): tiers of a base vehicle type,
-- vehicles approved for them, and what an online driver can be offered.
-- AlterTable
ALTER TABLE "driver_presence" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ride_ratings" ADD COLUMN     "acIssue" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vehicle_categories" ADD COLUMN     "description" TEXT,
ADD COLUMN     "minYear" INTEGER,
ADD COLUMN     "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "parentKey" TEXT,
ADD COLUMN     "requiresAc" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "hasAc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tiersOff" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Drivers online now keep getting their own type.
UPDATE "driver_presence" SET "categories" = ARRAY["category"];
