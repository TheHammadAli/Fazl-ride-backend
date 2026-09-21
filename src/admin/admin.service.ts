import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DriverDocumentsService } from '../drivers/driver-documents.service.js';
import { DriverRequirementsService } from '../drivers/driver-requirements.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListDriversDto, ListUsersDto } from './dto/admin.dto.js';

const driverInclude = {
  user: { select: { id: true, phone: true, name: true, email: true } },
  vehicles: true,
  documents: { orderBy: { createdAt: 'asc' } },
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DriverDocumentsService,
    private readonly requirements: DriverRequirementsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async listUsers({ page, limit, search }: ListUsersDto) {
    const where = search
      ? {
          OR: [
            { phone: { contains: search } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { roles: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async listDrivers({ page, limit, status }: ListDriversDto) {
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where,
        include: driverInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.driverProfile.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // Detail view: includes signed, short-lived links to the uploaded papers.
  async getDriver(id: string) {
    const profile = await this.findDriver(id);
    return {
      ...profile,
      documents: await this.documents.withUrls(profile.documents),
    };
  }

  // Plain lookup with no storage calls, so approvals never depend on storage.
  private async findDriver(id: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: driverInclude,
    });
    if (!profile) throw new NotFoundException('Driver application not found');
    return profile;
  }

  // Approving a driver also approves the vehicles they applied with and
  // grants the `driver` role, which unlocks Driver mode in the app.
  async approveDriver(id: string, adminId: string) {
    const profile = await this.findDriver(id);
    if (profile.status === 'approved') {
      throw new ConflictException('Driver is already approved');
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
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id },
        data: {
          status: 'approved',
          rejectionReason: null,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.vehicle.updateMany({
        where: { driverProfileId: id, status: 'pending' },
        data: { status: 'approved' },
      }),
      this.prisma.userRole.upsert({
        where: { userId_role: { userId: profile.userId, role: Role.driver } },
        update: {},
        create: { userId: profile.userId, role: Role.driver },
      }),
    ]);
    await this.audit.log(adminId, 'driver.approve', 'driver_profile', id);
    return this.findDriver(id);
  }

  async rejectDriver(id: string, adminId: string, reason: string) {
    const profile = await this.findDriver(id);
    if (profile.status === 'rejected') {
      throw new ConflictException('Driver is already rejected');
    }
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectionReason: reason,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.vehicle.updateMany({
        where: { driverProfileId: id, status: 'pending' },
        data: { status: 'rejected' },
      }),
      // A previously approved driver who is rejected loses Driver mode.
      this.prisma.userRole.deleteMany({
        where: { userId: profile.userId, role: Role.driver },
      }),
    ]);
    await this.audit.log(adminId, 'driver.reject', 'driver_profile', id, {
      reason,
    });
    return this.findDriver(id);
  }

  async suspendDriver(id: string, adminId: string, reason: string) {
    const profile = await this.findDriver(id);
    if (profile.status !== 'approved') {
      throw new ConflictException('Only approved drivers can be suspended');
    }
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id },
        data: { status: 'suspended', suspensionReason: reason },
      }),
      this.prisma.userRole.deleteMany({
        where: { userId: profile.userId, role: Role.driver },
      }),
    ]);
    await this.audit.log(adminId, 'driver.suspend', 'driver_profile', id, {
      reason,
    });
    return this.findDriver(id);
  }

  async reinstateDriver(id: string, adminId: string) {
    const profile = await this.findDriver(id);
    if (profile.status !== 'suspended') {
      throw new ConflictException('Only suspended drivers can be reinstated');
    }
    await this.prisma.$transaction([
      this.prisma.driverProfile.update({
        where: { id },
        data: { status: 'approved', suspensionReason: null },
      }),
      this.prisma.userRole.upsert({
        where: { userId_role: { userId: profile.userId, role: Role.driver } },
        update: {},
        create: { userId: profile.userId, role: Role.driver },
      }),
    ]);
    await this.audit.log(adminId, 'driver.reinstate', 'driver_profile', id);
    return this.findDriver(id);
  }

  async blockUser(id: string, actor: AuthUser, reason: string) {
    if (id === actor.id)
      throw new ForbiddenException('You cannot block yourself');
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!target || target.status === 'deleted')
      throw new NotFoundException('User not found');
    const targetIsAdmin = target.roles.some(
      (r) => r.role === 'admin' || r.role === 'super_admin',
    );
    if (targetIsAdmin && !actor.roles.includes(Role.super_admin)) {
      throw new ForbiddenException('Only a super admin can block an admin');
    }
    if (target.status === 'blocked')
      throw new ConflictException('User is already blocked');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { status: 'blocked', blockedReason: reason },
      }),
      // Signed-in devices lose access as soon as their access token is checked.
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log(actor.id, 'user.block', 'user', id, { reason });
    this.events.emit('user.blocked', { userId: id });
    return { id, status: 'blocked' as const };
  }

  async unblockUser(id: string, actorId: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.status === 'deleted')
      throw new NotFoundException('User not found');
    if (target.status !== 'blocked')
      throw new ConflictException('User is not blocked');
    await this.prisma.user.update({
      where: { id },
      data: { status: 'active', blockedReason: null },
    });
    await this.audit.log(actorId, 'user.unblock', 'user', id);
    return { id, status: 'active' as const };
  }

  async setVehicleStatus(
    id: string,
    status: 'approved' | 'rejected',
    actorId: string,
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { documents: { select: { type: true, vehicleId: true } } },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    if (status === 'approved') {
      const missing = this.requirements.missing([vehicle], vehicle.documents);
      // Only the vehicle's own papers matter here, not the driver's.
      const vehicleMissing = missing.filter((m) => m.vehicleId);
      if (vehicleMissing.length) {
        throw new BadRequestException({
          message: 'Required documents are missing',
          missing: vehicleMissing,
        });
      }
    }
    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { status },
    });
    await this.audit.log(
      actorId,
      `vehicle.${status === 'approved' ? 'approve' : 'reject'}`,
      'vehicle',
      id,
    );
    return updated;
  }
}
