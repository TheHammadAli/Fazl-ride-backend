import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VehicleCategoriesService } from '../vehicle-categories/vehicle-categories.service.js';
import { DriverDocumentsService } from './driver-documents.service.js';
import { DriverIdentityService } from './driver-identity.service.js';
import {
  DriverRequirementsService,
  MIN_DRIVER_AGE,
  ageOn,
  findMissingProfile,
  ReviewIssueField,
  isExpired,
  isFullName,
  reviewIssuesOf,
} from './driver-requirements.js';
import { DriverApprovalService } from './driver-approval.service.js';
import {
  ApplyDriverDto,
  UpdateDriverProfileDto,
  UpdateVehicleDto,
  VehicleDto,
} from './dto/driver.dto.js';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DriverDocumentsService,
    private readonly requirements: DriverRequirementsService,
    private readonly vehicleCategories: VehicleCategoriesService,
    private readonly identity: DriverIdentityService,
    private readonly approval: DriverApprovalService,
    private readonly events: DomainEvents,
  ) {}

  // "Become a Driver": creates a pending profile plus the first vehicle.
  // A rejected applicant may apply again; anyone else already has a profile.
  async apply(userId: string, dto: ApplyDriverDto) {
    await this.vehicleCategories.assertActive(dto.vehicle.category);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, avatarKey: true, phone: true },
    });
    // Passengers see the driver's name and face before getting in, and the
    // admin compares that face with the selfie and CNIC.
    const missing = [
      ...(user.name?.trim() ? [] : ['name']),
      ...(user.avatarKey ? [] : ['avatar']),
    ];
    if (missing.length) {
      throw new BadRequestException({
        message: 'Add your full name and a profile photo before applying',
        missingProfile: missing,
      });
    }
    if (!isFullName(user.name!)) {
      throw new BadRequestException(
        'Your name must be your full name as on your CNIC (first and last name, letters only)',
      );
    }
    const dates = this.identityDates(dto);
    this.assertEmergencyContact(dto.emergencyContact, user.phone);
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
          licenseExpiry: dates.licenseExpiry!,
          dateOfBirth: dates.dateOfBirth!,
          emergencyContact: dto.emergencyContact,
          status: 'pending' as const,
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
          // A draft until the driver presses "Submit for review".
          submittedAt: null,
          reviewIssues: Prisma.DbNull,
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
        user: { select: { name: true, avatarKey: true } },
      },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    // Tells the app what is still left before admin review can succeed.
    const { documents, user, ...rest } = profile;
    return {
      ...rest,
      missingDocuments: this.requirements.missing(profile.vehicles, documents),
      missingProfile: findMissingProfile(user, profile),
    };
  }

  async updateProfile(userId: string, dto: UpdateDriverProfileDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { user: { select: { phone: true } } },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    const dates = this.identityDates(dto);
    if (dto.emergencyContact) {
      this.assertEmergencyContact(dto.emergencyContact, profile.user.phone);
    }

    // Filling in a missing date is fine; changing one the admin already
    // reviewed is not something to take on trust.
    const sameDay = (a: Date | null, b?: Date) =>
      !b || (a !== null && a.getTime() === b.getTime());
    const changed = [
      ...(profile.dateOfBirth &&
      !sameDay(profile.dateOfBirth, dates.dateOfBirth)
        ? ['dateOfBirth']
        : []),
      ...(profile.licenseExpiry &&
      !sameDay(profile.licenseExpiry, dates.licenseExpiry)
        ? ['licenseExpiry']
        : []),
    ];
    // CNIC and licence number are fixed once approved (only support may
    // change them); before that the driver can correct them.
    if ((dto.cnic || dto.licenseNumber) && profile.status === 'approved') {
      throw new ConflictException(
        'Contact support to change your CNIC or licence number',
      );
    }
    if (changed.length) await this.identity.beforeChange(userId);

    try {
      await this.prisma.driverProfile.update({
        where: { userId },
        data: {
          dateOfBirth: dates.dateOfBirth,
          licenseExpiry: dates.licenseExpiry,
          emergencyContact: dto.emergencyContact,
          cnic: dto.cnic,
          licenseNumber: dto.licenseNumber,
        },
      });
    } catch (error: any) {
      throw this.uniqueConflict(error) ?? error;
    }
    const fields = [
      'dateOfBirth',
      'licenseExpiry',
      'emergencyContact',
      'cnic',
      'licenseNumber',
    ] as const satisfies readonly (ReviewIssueField &
      keyof UpdateDriverProfileDto)[];
    await this.identity.resolveIssues(
      userId,
      fields.filter((f) => dto[f] !== undefined).map((field) => ({ field })),
    );
    if (changed.length) await this.identity.sendForReview(userId, changed);
    else await this.identity.recheckPending(userId);
    return this.getMine(userId);
  }

  // "Submit for review": only a complete application goes to the admin, who
  // is notified. After a rejection every flagged item must be fixed first.
  async submit(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        vehicles: true,
        documents: { select: { type: true, vehicleId: true } },
        user: { select: { name: true, avatarKey: true } },
      },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    if (profile.status === 'approved') {
      throw new ConflictException('You are already an approved driver');
    }
    if (profile.status === 'suspended') {
      throw new ForbiddenException('Your driver account is suspended');
    }
    if (profile.status === 'pending' && profile.submittedAt) {
      throw new ConflictException('Your application is already under review');
    }
    const forReview = profile.vehicles.filter((v) => v.status !== 'approved');
    const missingDocuments = this.requirements.missing(
      forReview,
      profile.documents,
    );
    const missingProfile = findMissingProfile(profile.user, profile);
    const unresolvedIssues = reviewIssuesOf(profile.reviewIssues);
    if (
      missingDocuments.length ||
      missingProfile.length ||
      unresolvedIssues.length
    ) {
      throw new BadRequestException({
        message: unresolvedIssues.length
          ? 'Fix everything the reviewer pointed out before submitting again'
          : 'Your application is not complete yet',
        missingDocuments,
        missingProfile,
        unresolvedIssues,
      });
    }
    const resubmitted = profile.status === 'rejected';
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id: profile.id },
        data: {
          status: 'pending',
          submittedAt: new Date(),
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
        },
      }),
      this.prisma.vehicle.updateMany({
        where: { driverProfileId: profile.id, status: 'rejected' },
        data: { status: 'pending' },
      }),
    ]);
    this.events.emit('driver.application_submitted', {
      userId,
      profileId: profile.id,
      resubmitted,
    });
    await this.identity.notifyAdmin(
      userId,
      profile.id,
      'driver.application_submitted',
      resubmitted
        ? 'Driver application re-submitted'
        : 'New driver application',
      resubmitted
        ? 'fixed the flagged items and re-submitted for review.'
        : 'submitted a driver application for review.',
    );
    await this.approval.maybeAutoApprove(profile.id);
    return this.getMine(userId);
  }

  // Correcting a vehicle that is not approved yet (a draft, or flagged on a
  // rejection). Approved vehicles are fixed.
  async updateVehicle(
    userId: string,
    vehicleId: string,
    dto: UpdateVehicleDto,
  ) {
    if (dto.category) await this.vehicleCategories.assertActive(dto.category);
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: { select: { id: true, status: true } } },
    });
    if (!profile) throw new NotFoundException('No driver application found');
    const vehicle = profile.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (vehicle.status === 'approved') {
      throw new ConflictException('An approved vehicle cannot be changed');
    }
    try {
      await this.prisma.vehicle.update({ where: { id: vehicleId }, data: dto });
    } catch (error: any) {
      throw this.uniqueConflict(error) ?? error;
    }
    await this.identity.resolveIssues(userId, [
      { field: 'vehicle', vehicleId },
    ]);
    return this.getMine(userId);
  }

  private identityDates(dto: { dateOfBirth?: string; licenseExpiry?: string }) {
    const dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined;
    const licenseExpiry = dto.licenseExpiry
      ? new Date(dto.licenseExpiry)
      : undefined;
    const now = new Date();
    if (dateOfBirth && (dateOfBirth > now || ageOn(dateOfBirth, now) > 100)) {
      throw new BadRequestException('dateOfBirth is not a valid birth date');
    }
    if (dateOfBirth && ageOn(dateOfBirth, now) < MIN_DRIVER_AGE) {
      throw new BadRequestException(
        `You must be at least ${MIN_DRIVER_AGE} years old to drive`,
      );
    }
    if (licenseExpiry && isExpired(licenseExpiry, now)) {
      throw new BadRequestException('Your driving licence has expired');
    }
    return { dateOfBirth, licenseExpiry };
  }

  private assertEmergencyContact(contact: string, ownPhone: string) {
    if (contact === ownPhone) {
      throw new BadRequestException(
        "The emergency contact must be someone else's number",
      );
    }
  }

  async addVehicle(userId: string, dto: VehicleDto) {
    await this.vehicleCategories.assertActive(dto.category);
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
