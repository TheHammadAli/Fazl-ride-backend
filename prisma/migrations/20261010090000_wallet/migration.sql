-- Wallets: balances, ledger, top-up / withdrawal requests, settings, and
-- commission + wallet payment on rides.
-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('topup', 'ride_payment', 'ride_earning', 'commission', 'change_sent', 'change_received', 'withdrawal', 'withdrawal_reversal', 'adjustment', 'refund');

-- CreateEnum
CREATE TYPE "WalletRequestKind" AS ENUM ('topup', 'withdrawal');

-- CreateEnum
CREATE TYPE "WalletRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterEnum
ALTER TYPE "EarningType" ADD VALUE 'commission';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'wallet';

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "commission" INTEGER,
ADD COLUMN     "walletPaid" INTEGER;

-- CreateTable
CREATE TABLE "wallets" (
    "userId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "rideId" UUID,
    "requestId" UUID,
    "note" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "WalletRequestKind" NOT NULL,
    "status" "WalletRequestStatus" NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "proofKey" TEXT,
    "accountTitle" TEXT,
    "accountNumber" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "commissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "driverMinBalance" INTEGER NOT NULL DEFAULT -500,
    "minTopup" INTEGER NOT NULL DEFAULT 100,
    "maxTopup" INTEGER NOT NULL DEFAULT 50000,
    "minWithdrawal" INTEGER NOT NULL DEFAULT 1000,
    "maxChange" INTEGER NOT NULL DEFAULT 500,
    "walletPaymentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "topupInstructions" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_key_key" ON "wallet_transactions"("key");

-- CreateIndex
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_requests_status_kind_createdAt_idx" ON "wallet_requests"("status", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_requests_userId_createdAt_idx" ON "wallet_requests"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_requests" ADD CONSTRAINT "wallet_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The single settings row, with the defaults above.
INSERT INTO "wallet_settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
