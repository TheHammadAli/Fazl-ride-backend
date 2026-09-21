-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('requested', 'accepted', 'arrived', 'started', 'completed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('passenger', 'driver', 'system');

-- CreateTable
CREATE TABLE "rides" (
    "id" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "driverId" UUID,
    "vehicleId" UUID,
    "category" "VehicleCategory" NOT NULL,
    "status" "RideStatus" NOT NULL DEFAULT 'requested',
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "estimatedDistanceMeters" INTEGER NOT NULL,
    "estimatedDurationSeconds" INTEGER NOT NULL,
    "estimatedFare" INTEGER NOT NULL,
    "distanceMeters" INTEGER,
    "durationSeconds" INTEGER,
    "fare" INTEGER,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "cancellationFee" INTEGER NOT NULL DEFAULT 0,
    "cancelledBy" "CancelledBy",
    "cancelReason" TEXT,
    "searchStep" INTEGER NOT NULL DEFAULT 0,
    "searchRadiusMeters" INTEGER NOT NULL,
    "nextExpandAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_offers" (
    "id" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'pending',
    "distanceToPickupMeters" INTEGER NOT NULL,
    "etaSeconds" INTEGER NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ride_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rides_passengerId_status_idx" ON "rides"("passengerId", "status");

-- CreateIndex
CREATE INDEX "rides_driverId_status_idx" ON "rides"("driverId", "status");

-- CreateIndex
CREATE INDEX "rides_status_expiresAt_idx" ON "rides"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ride_offers_driverId_status_idx" ON "ride_offers"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ride_offers_rideId_driverId_key" ON "ride_offers"("rideId", "driverId");

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A passenger can have only one ride in progress at a time. Prisma cannot express
-- a partial unique index, so it lives here; the app turns a violation into a 409.
CREATE UNIQUE INDEX "rides_one_active_per_passenger"
  ON "rides" ("passengerId")
  WHERE "status" IN ('requested', 'accepted', 'arrived', 'started');

-- Same for drivers: at most one ride in progress.
CREATE UNIQUE INDEX "rides_one_active_per_driver"
  ON "rides" ("driverId")
  WHERE "driverId" IS NOT NULL AND "status" IN ('accepted', 'arrived', 'started');
