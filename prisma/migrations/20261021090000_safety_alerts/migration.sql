-- SOS: safety alerts raised by passengers and drivers, and a passenger's
-- own emergency contact.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emergencyContact" TEXT;

-- CreateEnum
CREATE TYPE "SafetyAlertStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'cancelled');

-- CreateTable
CREATE TABLE "safety_alerts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "rideId" UUID,
    "status" "SafetyAlertStatus" NOT NULL DEFAULT 'open',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "locationAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_alerts_status_createdAt_idx" ON "safety_alerts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "safety_alerts_userId_status_idx" ON "safety_alerts"("userId", "status");

-- AddForeignKey
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alerts" ADD CONSTRAINT "safety_alerts_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;
