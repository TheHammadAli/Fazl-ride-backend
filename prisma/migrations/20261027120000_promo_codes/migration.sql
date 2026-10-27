-- Promo codes and their use on rides.
-- CreateEnum
CREATE TYPE "PromoDiscountType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "PromoRedemptionStatus" AS ENUM ('reserved', 'used');

-- AlterEnum
ALTER TYPE "WalletTransactionType" ADD VALUE 'promo_credit';

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "promoDiscount" INTEGER;

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "PromoDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxDiscount" INTEGER,
    "minFare" INTEGER NOT NULL DEFAULT 0,
    "service" TEXT,
    "firstRideOnly" BOOLEAN NOT NULL DEFAULT false,
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promoId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "status" "PromoRedemptionStatus" NOT NULL DEFAULT 'reserved',
    "discount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_rideId_key" ON "promo_redemptions"("rideId");

-- CreateIndex
CREATE INDEX "promo_redemptions_promoId_status_idx" ON "promo_redemptions"("promoId", "status");

-- CreateIndex
CREATE INDEX "promo_redemptions_userId_promoId_idx" ON "promo_redemptions"("userId", "promoId");

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

