import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DriverDocumentsService } from './driver-documents.service.js';
import { DriverRequirementsService } from './driver-requirements.js';
import { ApplyDriverDto, VehicleDto } from './dto/driver.dto.js';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DriverDocumentsService,
    private readonly requirements: DriverRequirementsService,
  ) {}

  // "Become a Driver": creates a pending profile plus the first vehicle.
  // A rejected applicant may apply again; anyone else already has a profile.
  async apply(userId: string, dto: ApplyDriverDto) {
    const existing = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (existing && existing.status !== 'rejected') {
      throw new ConflictException(
        `You already have a driver application (${existing.status})`,
      );
    }

    // Re-applying drops the old vehicles; their registration files go with them.
    let staleKeys: string[] = [];
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const data = {
          cnic: dto.cnic,
          licenseNumber: dto.licenseNumber,
          status: 'pending' as const,
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
        };
        const profile = existing
          ? await tx.driverProfile.update({ where: { userId }, data })
          : await tx.driverProfile.create({ data: { userId, ...data } });
        if (existing) {
          const stale = await tx.driverDocument.findMany({
            where: { driverProfileId: profile.id, vehicleId: { not: null } },
            select: { storageKey: true },
          });
          staleKeys = stale.map((d) => d.storageKey);
          await tx.vehicle.deleteMany({
            where: { driverProfileId: profile.id },
          });
        }
        await tx.vehicle.create({
          data: this.vehicleData(profile.id, dto.vehicle),
        });
        return tx.driverProfile.findUniqueOrThrow({
          where: { id: profile.id },
          include: { vehicles: true },
        });
      });
      await this.documents.removeQuietly(staleKeys);
      return result;
    } catch (error: any) {
      throw this.uniqueConflict(error) ?? error;
    }
  }

  async getMine(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        vehicles: true,
        documents: { select: { type: true, vehicleId: true } },
      },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    // Tells the app what is still left to upload before admin review can succeed.
    const { documents, ...rest } = profile;
    return {
      ...rest,
      missingDocuments: this.requirements.missing(profile.vehicles, documents),
    };
  }

  async addVehicle(userId: string, dto: VehicleDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    if (profile.status !== 'approved') {
      throw new ForbiddenException('Only approved drivers can add vehicles');
    }
    try {
      return await this.prisma.vehicle.create({
        data: this.vehicleData(profile.id, dto),
      });
    } catch (error: any) {
      throw this.uniqueConflict(error) ?? error;
    }
  }

  // A driver always keeps at least one vehicle. Its registration file goes too.
  async removeVehicle(userId: string, vehicleId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        vehicles: { include: { documents: { select: { storageKey: true } } } },
      },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    const vehicle = profile.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (profile.vehicles.length === 1) {
      throw new ConflictException('You cannot remove your only vehicle');
    }
    await this.prisma.vehicle.delete({ where: { id: vehicleId } });
    await this.documents.removeQuietly(
      vehicle.documents.map((d) => d.storageKey),
    );
    return { message: 'Vehicle removed' };
  }

  private vehicleData(driverProfileId: string, v: VehicleDto) {
    return {
      driverProfileId,
      category: v.category,
      make: v.make,
      model: v.model,
      year: v.year,
      color: v.color,
      plateNumber: v.plateNumber,
    };
  }

  // With the pg driver adapter the violated constraint name (for example
  // `driver_profiles_cnic_key`) is nested inside `meta.driverAdapterError`.
  private uniqueConflict(error: any) {
    if (error?.code !== 'P2002') return null;
    const constraint = JSON.stringify(error.meta ?? {});
    if (constraint.includes('cnic')) {
      return new ConflictException('CNIC is already registered');
    }
    if (constraint.includes('plateNumber')) {
      return new ConflictException(
        'Vehicle plate number is already registered',
      );
    }
    if (constraint.includes('userId')) {
      return new ConflictException('You already have a driver application');
    }
    return new ConflictException('Already registered');
  }
}
