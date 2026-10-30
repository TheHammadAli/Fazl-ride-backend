-- Cities FAZL operates in, and the rule that rides start only there.
-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "onlyServiceCities" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "service_cities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Pakistan',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusKm" INTEGER NOT NULL DEFAULT 25,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_cities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_cities_name_country_key" ON "service_cities"("name", "country");

