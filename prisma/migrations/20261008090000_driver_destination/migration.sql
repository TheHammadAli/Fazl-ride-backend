-- Driver destination mode ("Go Home").
CREATE TABLE "driver_destinations" (
    "userId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "usesDay" TIMESTAMP(3),
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_destinations_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "driver_destinations" ADD CONSTRAINT "driver_destinations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
