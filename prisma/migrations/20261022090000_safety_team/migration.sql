-- SOS: the safety team that gets alerts on their phones, and when an alert
-- nobody took was sent to them again.
-- AlterTable
ALTER TABLE "safety_alerts" ADD COLUMN     "realertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "safety_team_members" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "safety_team_members_phone_key" ON "safety_team_members"("phone");
