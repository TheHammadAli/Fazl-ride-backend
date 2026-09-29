-- In-app chat between a ride's passenger and its assigned driver.
CREATE TABLE "ride_messages" (
    "id" UUID NOT NULL,
    "rideId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ride_messages_rideId_createdAt_idx" ON "ride_messages"("rideId", "createdAt");

ALTER TABLE "ride_messages" ADD CONSTRAINT "ride_messages_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ride_messages" ADD CONSTRAINT "ride_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
