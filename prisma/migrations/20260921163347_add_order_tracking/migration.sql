-- CreateTable
CREATE TABLE "order_statuses" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "terminal" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "aliases" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_statuses_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tracked_orders" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'fazl',
    "externalId" TEXT NOT NULL,
    "customerRef" TEXT,
    "customerPhone" TEXT,
    "pickupAddress" TEXT,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "deliveryAddress" TEXT NOT NULL,
    "deliveryLat" DOUBLE PRECISION NOT NULL,
    "deliveryLng" DOUBLE PRECISION NOT NULL,
    "statusKey" TEXT NOT NULL,
    "deliveryPersonId" TEXT,
    "deliveryPersonName" TEXT,
    "deliveryPersonPhone" TEXT,
    "deliveryPersonPhotoUrl" TEXT,
    "deliveryPersonRating" DOUBLE PRECISION,
    "vehicleType" TEXT,
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,
    "vehicleColor" TEXT,
    "vehiclePlate" TEXT,
    "lastLat" DOUBLE PRECISION,
    "lastLng" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "etaSeconds" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "statusKey" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_location_points" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_location_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_tokens" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracked_orders_customerPhone_idx" ON "tracked_orders"("customerPhone");

-- CreateIndex
CREATE INDEX "tracked_orders_deliveryPersonId_idx" ON "tracked_orders"("deliveryPersonId");

-- CreateIndex
CREATE INDEX "tracked_orders_statusKey_idx" ON "tracked_orders"("statusKey");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_orders_source_externalId_key" ON "tracked_orders"("source", "externalId");

-- CreateIndex
CREATE INDEX "order_status_events_orderId_at_idx" ON "order_status_events"("orderId", "at");

-- CreateIndex
CREATE INDEX "order_location_points_orderId_at_idx" ON "order_location_points"("orderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_tokens_tokenHash_key" ON "tracking_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "tracking_tokens_orderId_idx" ON "tracking_tokens"("orderId");

-- AddForeignKey
ALTER TABLE "tracked_orders" ADD CONSTRAINT "tracked_orders_statusKey_fkey" FOREIGN KEY ("statusKey") REFERENCES "order_statuses"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tracked_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_statusKey_fkey" FOREIGN KEY ("statusKey") REFERENCES "order_statuses"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_location_points" ADD CONSTRAINT "order_location_points_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tracked_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_tokens" ADD CONSTRAINT "tracking_tokens_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "tracked_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The steps from the spec (Section 7). An admin can rename, reorder or add steps later.
INSERT INTO "order_statuses" ("key", "label", "position", "terminal", "active", "aliases", "updatedAt") VALUES
  ('order_confirmed',  'Order Confirmed',  10, false, true, '{}', CURRENT_TIMESTAMP),
  ('preparing',        'Preparing',        20, false, true, '{}', CURRENT_TIMESTAMP),
  ('ready_for_pickup', 'Ready for Pickup', 30, false, true, '{}', CURRENT_TIMESTAMP),
  ('driver_assigned',  'Driver Assigned',  40, false, true, '{}', CURRENT_TIMESTAMP),
  ('picked_up',        'Picked Up',        50, false, true, '{}', CURRENT_TIMESTAMP),
  ('in_transit',       'In Transit',       60, false, true, '{}', CURRENT_TIMESTAMP),
  ('near_destination', 'Near Destination', 70, false, true, '{}', CURRENT_TIMESTAMP),
  ('delivered',        'Delivered',        80, true,  true, '{}', CURRENT_TIMESTAMP),
  ('cancelled',        'Cancelled',        90, true,  true, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
