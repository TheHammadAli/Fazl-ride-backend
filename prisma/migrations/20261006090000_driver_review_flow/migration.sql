-- AlterTable
ALTER TABLE "driver_profiles" ADD COLUMN     "reviewIssues" JSONB,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_notifications_createdAt_idx" ON "admin_notifications"("createdAt");

-- Existing applications were reviewable as soon as everything was uploaded;
-- treat pending ones as already submitted so they stay in the admin's queue.
UPDATE "driver_profiles" SET "submittedAt" = "updatedAt" WHERE "status" = 'pending';
