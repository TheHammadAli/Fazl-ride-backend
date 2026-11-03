-- Rides with stops on the way (inDrive style), and what waiting at them costs.
ALTER TABLE "fare_configs" ADD COLUMN IF NOT EXISTS "freeWaitingMinutes" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "fare_configs" ADD COLUMN IF NOT EXISTS "waitingPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "waitingCharge" INTEGER;

CREATE TABLE IF NOT EXISTS "ride_stops" (
    "id" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "waitedSeconds" INTEGER,
    "waitingCharge" INTEGER,

    CONSTRAINT "ride_stops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ride_stops_rideId_position_key" ON "ride_stops"("rideId", "position");

ALTER TABLE "ride_stops" DROP CONSTRAINT IF EXISTS "ride_stops_rideId_fkey";
ALTER TABLE "ride_stops" ADD CONSTRAINT "ride_stops_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
