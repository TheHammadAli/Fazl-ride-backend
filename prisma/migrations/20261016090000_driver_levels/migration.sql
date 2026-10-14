-- Driver achievement levels and their rewards.
-- AlterEnum
ALTER TYPE "WalletTransactionType" ADD VALUE 'level_bonus';

-- AlterTable
ALTER TABLE "driver_profiles" ADD COLUMN     "levelKey" TEXT;

-- CreateTable
CREATE TABLE "driver_levels" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minRides" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#9CA3AF',
    "icon" TEXT NOT NULL DEFAULT 'star',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "commissionDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "priorityMeters" INTEGER NOT NULL DEFAULT 0,
    "minBalance" INTEGER,
    "perks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_levels_pkey" PRIMARY KEY ("key")
);

-- The levels asked for; rewards start empty and are set by admins.
INSERT INTO "driver_levels" ("key", "name", "minRides", "color", "icon", "updatedAt") VALUES
  ('silver', 'Silver', 500, '#9CA3AF', 'silver', CURRENT_TIMESTAMP),
  ('gold', 'Gold', 1000, '#F59E0B', 'gold', CURRENT_TIMESTAMP),
  ('platinum', 'Platinum', 3000, '#6366F1', 'platinum', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
