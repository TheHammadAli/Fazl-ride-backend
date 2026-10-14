import { VehicleTiersService } from '../vehicle-categories/vehicle-tiers.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DriverRequirementsService,
  findMissingProfile,
} from './driver-requirements.js';

// Approving a driver also approves the vehicles they applied with and grants
// the `driver` role, which unlocks Driver mode in the app. One place decides
// what "approved" means, used by both the real admin endpoint and the
// DEV_AUTO_APPROVE_DRIVERS dev flow below.
@Injectable()
export class DriverApprovalService {
  private readonly logger = new Logger(DriverApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requirements: DriverRequirementsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly tiers: VehicleTiersService,
  ) {}

  // actorId is the admin who approved, or null for the dev auto-approve
  // (there is no admin - see auditLog.actorId, already nullable for API keys).
  async approve(profileId: string, actorId: string | null, action: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: profileId },
      include: {
        vehicles: true,
        documents: true,
        user: { select: { name: true, avatarKey: true } },
      },
    });
    if (!profile) throw new NotFoundException('Driver application not found');
    if (profile.status === 'approved') {
      throw new ConflictException('Driver is already approved');
    }
    // Only what the driver chose to send is reviewed, not a half-filled draft.
    if (!profile.submittedAt) {
      throw new BadRequestException(
        'The driver has not submitted the application for review yet',
      );
    }
    const pendingVehicles = profile.vehicles.filter(
      (v) => v.status === 'pending',
    );
    const missing = this.requirements.missing(
      pendingVehicles,
      profile.documents,
    );
    if (missing.length) {
      throw new BadRequestException({
        message: 'Required documents are missing',
        missing,
      });
    }
    const missingProfile = findMissingProfile(profile.user, profile);
    if (missingProfile.length) {
      throw new BadRequestException({
        message: 'The driver profile is incomplete',
        missingProfile,
      });
    }
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id: profileId },
        data: {
          status: 'approved',
          rejectionReason: null,
          reviewIssues: Prisma.DbNull,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.vehicle.updateMany({
        where: { driverProfileId: profileId, status: 'pending' },
        data: { status: 'approved' },
      }),
      this.prisma.userRole.upsert({
        where: { userId_role: { userId: profile.userId, role: Role.driver } },
        update: {},
        create: { userId: profile.userId, role: Role.driver },
      }),
    ]);
    // Newly approved vehicles get the tiers they meet (Business, AC...).
    const vehicles = await this.prisma.vehicle.findMany({
      where: { driverProfileId: profileId, status: 'approved' },
      select: { id: true },
    });
    await this.tiers.applySuggestion(vehicles.map((v) => v.id));
    await this.audit.log(actorId, action, 'driver_profile', profileId);
  }

  // Called after every document upload: while DEV_AUTO_APPROVE_DRIVERS=true,
  // the moment a driver's real "Become a Driver" documents satisfy the
  // requirements, they are approved on the spot - no admin needed. This is
  // for testing the real apply/upload screens end to end without an admin
  // panel; it must never be true on a server real drivers reach.
  async maybeAutoApprove(profileId: string): Promise<boolean> {
    if (!this.enabled()) return false;
    try {
      await this.approve(profileId, null, 'driver.auto_approve_dev');
      this.logger.warn(
        `DEV_AUTO_APPROVE_DRIVERS approved driver profile ${profileId}`,
      );
      return true;
    } catch (error) {
      // Not ready yet (docs still missing) or already approved: both fine
      // to ignore here, this is just an opportunistic check.
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        return false;
      }
      throw error;
    }
  }

  private enabled(): boolean {
    return (
      String(
        this.config.get('DEV_AUTO_APPROVE_DRIVERS') ?? '',
      ).toLowerCase() === 'true'
    );
  }
}
