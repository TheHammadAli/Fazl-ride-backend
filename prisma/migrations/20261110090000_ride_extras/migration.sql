-- Ride extras (inDrive style): a note and options for the driver, booking
-- for someone else, and "share my trip" links.
-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "note" TEXT,
ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "riderName" TEXT,
ADD COLUMN     "riderPhone" TEXT;

-- CreateTable
CREATE TABLE "ride_share_links" (
    "id" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ride_share_links_tokenHash_key" ON "ride_share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "ride_share_links_rideId_idx" ON "ride_share_links"("rideId");

-- AddForeignKey
ALTER TABLE "ride_share_links" ADD CONSTRAINT "ride_share_links_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

