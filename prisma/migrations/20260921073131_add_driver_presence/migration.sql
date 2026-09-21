-- CreateTable
CREATE TABLE "driver_presence" (
    "userId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "category" "VehicleCategory" NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "busy" BOOLEAN NOT NULL DEFAULT false,
    "location" geography(Point,4326),
    "heading" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "locationUpdatedAt" TIMESTAMP(3),
    "onlineSince" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_presence_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "driver_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "driver_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_presence_location_idx" ON "driver_presence" USING GIST ("location");

-- CreateIndex
CREATE INDEX "driver_presence_isOnline_category_idx" ON "driver_presence"("isOnline", "category");

-- CreateIndex
CREATE INDEX "driver_sessions_userId_startedAt_idx" ON "driver_sessions"("userId", "startedAt");
