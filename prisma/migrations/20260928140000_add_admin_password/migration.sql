-- Web-admin accounts log in with email + password; everyone else keeps using OTP.
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;
