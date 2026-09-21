-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('cnic_front', 'cnic_back', 'license_front', 'license_back', 'selfie', 'vehicle_registration');

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "vehicleId" UUID,
    "type" "DocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_storageKey_key" ON "driver_documents"("storageKey");

-- CreateIndex
CREATE INDEX "driver_documents_driverProfileId_idx" ON "driver_documents"("driverProfileId");

-- CreateIndex
CREATE INDEX "driver_documents_vehicleId_idx" ON "driver_documents"("vehicleId");

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
