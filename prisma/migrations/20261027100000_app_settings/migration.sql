-- Support contacts and legal links the apps read (GET config).
-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "supportPhone" TEXT,
    "supportWhatsapp" TEXT,
    "supportEmail" TEXT,
    "supportHours" TEXT,
    "privacyUrl" TEXT,
    "termsUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- The contact details the app showed until now; admins change them in Settings.
INSERT INTO "app_settings" ("id", "supportPhone", "supportEmail", "updatedAt")
VALUES (1, '+92 21 111 3295', 'support@fazl.pk', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
