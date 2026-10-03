import { Injectable } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DriverApprovalService } from './driver-approval.service.js';

// An admin approved a driver for the face, name and papers they saw. When an
// approved driver changes any of those, the approval no longer holds: the
// driver goes back to `pending` (Driver mode closes) until it is reviewed
// again - otherwise one person could be approved and another drive.
@Injectable()
export class DriverIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly approval: DriverApprovalService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  // Call before saving the change. Takes an approved driver offline, which
  // refuses (409) in the middle of a ride.
  async beforeChange(userId: string) {
    if (await this.approvedProfileId(userId)) {
      await this.presence.goOffline(userId);
    }
  }

  async sendForReview(userId: string, changed: string[]) {
    const profileId = await this.approvedProfileId(userId);
    if (!profileId) return;
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id: profileId },
        data: { status: 'pending', reviewedById: null, reviewedAt: null },
      }),
      this.prisma.userRole.deleteMany({
        where: { userId, role: Role.driver },
      }),
    ]);
    await this.audit.log(
      userId,
      'driver.identity_changed',
      'driver_profile',
      profileId,
      { changed },
    );
    this.events.emit('driver.review_required', { userId, profileId, changed });
    await this.approval.maybeAutoApprove(profileId);
  }

  // A pending driver may have just filled in the last missing detail; while
  // DEV_AUTO_APPROVE_DRIVERS=true that approves them, otherwise a no-op.
  async recheckPending(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (profile?.status === 'pending') {
      await this.approval.maybeAutoApprove(profile.id);
    }
  }

  private async approvedProfileId(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    return profile?.status === 'approved' ? profile.id : null;
  }
}
