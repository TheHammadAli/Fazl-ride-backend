-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OfferStatus" ADD VALUE 'bid';
ALTER TYPE "OfferStatus" ADD VALUE 'closed';

-- AlterTable
ALTER TABLE "ride_offers" ADD COLUMN     "bidAmount" INTEGER;

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "negotiable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offeredFare" INTEGER;
