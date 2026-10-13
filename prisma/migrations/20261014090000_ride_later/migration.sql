-- Ride Later: bookings for later the confirmed driver starts themselves,
-- admin-editable booking rules, and reminders sent once each.
-- AlterEnum
ALTER TYPE "RideStatus" ADD VALUE 'scheduled';

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "noShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "booking_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minAheadMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxAheadDays" INTEGER NOT NULL DEFAULT 7,
    "maxPerPassenger" INTEGER NOT NULL DEFAULT 3,
    "reservationRadiusKm" INTEGER NOT NULL DEFAULT 30,
    "rideStartBefore" INTEGER NOT NULL DEFAULT 60,
    "rideStartAfter" INTEGER NOT NULL DEFAULT 30,
    "freightStartBefore" INTEGER NOT NULL DEFAULT 90,
    "freightStartAfter" INTEGER NOT NULL DEFAULT 60,
    "intercityStartBefore" INTEGER NOT NULL DEFAULT 120,
    "intercityStartAfter" INTEGER NOT NULL DEFAULT 60,
    "rideWarnFirst" INTEGER NOT NULL DEFAULT 60,
    "rideWarnSecond" INTEGER NOT NULL DEFAULT 30,
    "freightWarnFirst" INTEGER NOT NULL DEFAULT 120,
    "freightWarnSecond" INTEGER NOT NULL DEFAULT 60,
    "intercityWarnFirst" INTEGER NOT NULL DEFAULT 360,
    "intercityWarnSecond" INTEGER NOT NULL DEFAULT 120,
    "reminderMinutes" INTEGER NOT NULL DEFAULT 60,
    "startNudgeMinutes" INTEGER NOT NULL DEFAULT 15,
    "eveningReminderHour" INTEGER NOT NULL DEFAULT 21,
    "lateReleaseMinutes" INTEGER NOT NULL DEFAULT 120,
    "noShowLimit" INTEGER NOT NULL DEFAULT 3,
    "noShowWindowDays" INTEGER NOT NULL DEFAULT 30,
    "noShowBlockDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_reminders" (
    "rideId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reminders_pkey" PRIMARY KEY ("rideId","kind")
);

-- CreateIndex
CREATE INDEX "rides_status_scheduledAt_idx" ON "rides"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The single settings row, with the defaults above.
INSERT INTO "booking_settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
