-- CreateTable
CREATE TABLE "fare_configs" (
    "category" "VehicleCategory" NOT NULL,
    "baseFare" INTEGER NOT NULL,
    "perKm" DOUBLE PRECISION NOT NULL,
    "perMinute" DOUBLE PRECISION NOT NULL,
    "minimumFare" INTEGER NOT NULL,
    "cancellationFee" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fare_configs_pkey" PRIMARY KEY ("category")
);

-- Placeholder rates so estimates work out of the box. The business must set the real ones.
INSERT INTO "fare_configs" ("category", "baseFare", "perKm", "perMinute", "minimumFare", "cancellationFee", "updatedAt") VALUES
  ('economy', 100, 30, 3, 150, 100, CURRENT_TIMESTAMP),
  ('comfort', 150, 40, 4, 220, 150, CURRENT_TIMESTAMP),
  ('xl',      200, 55, 5, 300, 200, CURRENT_TIMESTAMP)
ON CONFLICT ("category") DO NOTHING;
