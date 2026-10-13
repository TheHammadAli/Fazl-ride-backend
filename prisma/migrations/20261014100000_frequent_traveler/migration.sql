-- Frequent traveler schedules, their skipped days, and saved places.
-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN     "maxSchedules" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "scheduleAheadHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "scheduleId" UUID;

-- CreateTable
CREATE TABLE "saved_places" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_schedules" (
    "id" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "name" TEXT,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tripType" "TripType" NOT NULL DEFAULT 'within_city',
    "days" INTEGER[],
    "timeMinutes" INTEGER NOT NULL,
    "offeredFare" INTEGER,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'cash',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastDriverId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_schedule_skips" (
    "scheduleId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_schedule_skips_pkey" PRIMARY KEY ("scheduleId","date")
);

-- CreateIndex
CREATE INDEX "saved_places_userId_idx" ON "saved_places"("userId");

-- CreateIndex
CREATE INDEX "ride_schedules_active_idx" ON "ride_schedules"("active");

-- CreateIndex
CREATE INDEX "ride_schedules_passengerId_idx" ON "ride_schedules"("passengerId");

-- CreateIndex
CREATE UNIQUE INDEX "rides_scheduleId_scheduledAt_key" ON "rides"("scheduleId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ride_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_schedules" ADD CONSTRAINT "ride_schedules_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_schedule_skips" ADD CONSTRAINT "ride_schedule_skips_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ride_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
