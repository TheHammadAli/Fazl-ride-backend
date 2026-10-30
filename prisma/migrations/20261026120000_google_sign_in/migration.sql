-- "Continue with Google": the Google account linked to a user.
-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");
