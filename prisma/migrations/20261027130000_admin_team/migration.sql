-- Web admin team: temporary passwords and last sign-in.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastAdminLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

