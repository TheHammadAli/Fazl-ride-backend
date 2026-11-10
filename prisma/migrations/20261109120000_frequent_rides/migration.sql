CREATE TABLE "frequent_ride_applications" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "frequent_ride_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "frequent_ride_applications_driverId_key" ON "frequent_ride_applications"("driverId");
CREATE INDEX "frequent_ride_applications_status_createdAt_idx" ON "frequent_ride_applications"("status", "createdAt");
ALTER TABLE "frequent_ride_applications" ADD CONSTRAINT "frequent_ride_applications_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "frequent_ride_routes" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "title" TEXT,
    "departureTime" TEXT NOT NULL,
    "days" INTEGER[] NOT NULL,
    "seats" INTEGER NOT NULL,
    "fare" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "frequent_ride_routes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "frequent_ride_routes_active_days_idx" ON "frequent_ride_routes"("active", "days");
CREATE INDEX "frequent_ride_routes_driverId_active_idx" ON "frequent_ride_routes"("driverId", "active");
ALTER TABLE "frequent_ride_routes" ADD CONSTRAINT "frequent_ride_routes_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "frequent_ride_routes" ADD CONSTRAINT "frequent_ride_routes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "frequent_ride_stops" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "frequent_ride_stops_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "frequent_ride_stops_routeId_position_key" ON "frequent_ride_stops"("routeId", "position");
ALTER TABLE "frequent_ride_stops" ADD CONSTRAINT "frequent_ride_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "frequent_ride_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "frequent_ride_bookings" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "rideDate" DATE NOT NULL,
    "fromPosition" INTEGER NOT NULL,
    "toPosition" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "fare" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "frequent_ride_bookings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "frequent_ride_bookings_routeId_rideDate_status_idx" ON "frequent_ride_bookings"("routeId", "rideDate", "status");
CREATE INDEX "frequent_ride_bookings_passengerId_rideDate_idx" ON "frequent_ride_bookings"("passengerId", "rideDate");
ALTER TABLE "frequent_ride_bookings" ADD CONSTRAINT "frequent_ride_bookings_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "frequent_ride_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "frequent_ride_bookings" ADD CONSTRAINT "frequent_ride_bookings_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
