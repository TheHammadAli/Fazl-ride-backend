-- A new driver's first rides carry no commission.
-- AlterTable
ALTER TABLE "wallet_settings" ADD COLUMN     "freeRidesPerDriver" INTEGER NOT NULL DEFAULT 10;
