-- Cancellation fees are dropped: with cash-only rides there is no way to collect one.
-- AlterTable
ALTER TABLE "fare_configs" DROP COLUMN "cancellationFee";
-- AlterTable
ALTER TABLE "rides" DROP COLUMN "cancellationFee",
ADD COLUMN     "cancelledFromStatus" "RideStatus",
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "rates" JSONB,
ADD COLUMN     "trackedMeters" DOUBLE PRECISION NOT NULL DEFAULT 0;
