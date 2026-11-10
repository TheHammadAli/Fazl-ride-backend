-- Each driver's live average speed while moving, for travel times (see
-- src/routing/travel-speed.ts).
ALTER TABLE "driver_presence" ADD COLUMN IF NOT EXISTS "avgSpeedKmh" DOUBLE PRECISION;
