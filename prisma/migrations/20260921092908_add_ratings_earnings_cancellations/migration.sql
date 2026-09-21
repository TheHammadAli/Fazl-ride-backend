-- CreateEnum
CREATE TYPE "CancellationRole" AS ENUM ('passenger', 'driver');

-- CreateEnum
CREATE TYPE "EarningType" AS ENUM ('ride_fare', 'adjustment', 'cashout');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingSum" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ride_cancellations" (
    "id" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CancellationRole" NOT NULL,
    "fromStatus" "RideStatus" NOT NULL,
    "reason" TEXT,
    "forgivenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_ratings" (
    "id" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "raterId" UUID NOT NULL,
    "rateeId" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "EarningType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "rideId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ride_cancellations_userId_role_createdAt_idx" ON "ride_cancellations"("userId", "role", "createdAt");

-- CreateIndex
CREATE INDEX "ride_ratings_rateeId_idx" ON "ride_ratings"("rateeId");

-- CreateIndex
CREATE UNIQUE INDEX "ride_ratings_rideId_raterId_key" ON "ride_ratings"("rideId", "raterId");

-- CreateIndex
CREATE INDEX "driver_earnings_driverId_createdAt_idx" ON "driver_earnings"("driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "driver_earnings_rideId_type_key" ON "driver_earnings"("rideId", "type");

-- AddForeignKey
ALTER TABLE "ride_cancellations" ADD CONSTRAINT "ride_cancellations_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_cancellations" ADD CONSTRAINT "ride_cancellations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_rateeId_fkey" FOREIGN KEY ("rateeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
