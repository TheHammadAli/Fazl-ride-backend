-- Freight: floor and lift at each end, and loading/unloading help.
ALTER TABLE "rides" ADD COLUMN     "dropoffFloor" INTEGER,
ADD COLUMN     "dropoffHasLift" BOOLEAN,
ADD COLUMN     "needsLoading" BOOLEAN,
ADD COLUMN     "needsUnloading" BOOLEAN,
ADD COLUMN     "pickupFloor" INTEGER,
ADD COLUMN     "pickupHasLift" BOOLEAN;
