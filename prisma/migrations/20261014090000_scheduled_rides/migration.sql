-- Ride Later and scheduled freight.
ALTER TYPE "RideStatus" ADD VALUE 'scheduled' BEFORE 'requested';

ALTER TABLE "rides" ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "dispatchAt" TIMESTAMP(3);

-- The sweeper looks up scheduled rides whose search should start.
CREATE INDEX "rides_dispatchAt_idx" ON "rides"("dispatchAt");
