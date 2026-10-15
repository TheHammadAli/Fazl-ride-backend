import { VehicleTiersService } from '../vehicle-categories/vehicle-tiers.service.js';
import { isOpenTier } from '../vehicle-categories/vehicle-tiers.js';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DriverApprovalService } from '../drivers/driver-approval.service.js';
import { DriverDocumentsService } from '../drivers/driver-documents.service.js';
import { DriverRequirementsService } from '../drivers/driver-requirements.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  ListDriversDto,
  ListUsersDto,
  ListVehiclesDto,
  ReviewIssueDto,
} from './dto/admin.dto.js';

const driverInclude = {
  user: {
    select: { id: true, phone: true, name: true, email: true, avatarKey: true },
  },
  vehicles: true,
  documents: { orderBy: { createdAt: 'asc' } },
} as const;

// What a user row in the admin panel shows.
const userListInclude = {
  roles: true,
  wallet: { select: { balance: true } },
  _count: { select: { ridesAsPassenger: true, ridesAsDriver: true } },
} satisfies Prisma.UserInclude;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DriverDocumentsService,
    private readonly requirements: DriverRequirementsService,
    private readonly driverApproval: DriverApprovalService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly storage: StorageService,
    private readonly tiers: VehicleTiersService,
  ) {}

  async listUsers({ page, limit, search, status, role }: ListUsersDto) {
    const q = search?.trim();
    const matches: Prisma.UserWhereInput = {
      status: { not: 'deleted' },
      ...(role && { roles: { some: { role } } }),
      ...(q && {
        OR: [
          { phone: { contains: q } },
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
    const where: Prisma.UserWhereInput = {
      ...matches,
      ...(status && { status }),
    };
    const [users, total, byStatus] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: userListInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.groupBy({
        by: ['status'],
        where: matches,
        _count: { _all: true },
      }),
    ]);
    const count = (s: string) =>
      byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const items = await Promise.all(users.map((u) => this.presentUser(u)));
    return {
      items,
      total,
      page,
      limit,
      counts: { active: count('active'), blocked: count('blocked') },
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userListInclude,
    });
    if (!user || user.status === 'deleted') {
      throw new NotFoundException('User not found');
    }
    return this.presentUser(user);
  }

  private async presentUser(
    u: Prisma.UserGetPayload<{ include: typeof userListInclude }>,
  ) {
    return {
      id: u.id,
      phone: u.phone,
      name: u.name,
      email: u.email,
      status: u.status,
      blockedReason: u.blockedReason,
      roles: u.roles.map((r) => r.role),
      createdAt: u.createdAt,
      rating: u.ratingCount
        ? { average: u.ratingSum / u.ratingCount, count: u.ratingCount }
        : null,
      rides: {
        asPassenger: u._count.ridesAsPassenger,
        asDriver: u._count.ridesAsDriver,
      },
      walletBalance: u.wallet?.balance ?? 0,
      avatarUrl: u.avatarKey
        ? await this.storage
            .createSignedUrl(u.avatarKey, 10 * 60)
            .catch(() => null)
        : null,
    };
  }

  async listDrivers({
    page,
    limit,
    status,
    awaitingReview,
    search,
  }: ListDriversDto) {
    const q = search?.trim();
    const matches: Prisma.DriverProfileWhereInput = q
      ? {
          OR: [
            { cnic: { contains: q.replace(/-/g, '') } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
            { user: { phone: { contains: q } } },
            {
              vehicles: {
                some: { plateNumber: { contains: q, mode: 'insensitive' } },
              },
            },
          ],
        }
      : {};
    const where: Prisma.DriverProfileWhereInput = {
      ...matches,
      ...(awaitingReview
        ? { status: 'pending' as const, submittedAt: { not: null } }
        : status
          ? { status }
          : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where,
        include: driverInclude,
        orderBy: awaitingReview
          ? { submittedAt: 'asc' as const }
          : { createdAt: 'desc' as const },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.driverProfile.count({ where }),
      this.driverCounts(matches),
    ]);
    // Photos for the list; a photo that can not be signed just shows none.
    const withPhotos = await Promise.all(
      items.map(async ({ user: { avatarKey, ...user }, ...profile }) => ({
        ...profile,
        user: {
          ...user,
          avatarUrl: avatarKey
            ? await this.storage
                .createSignedUrl(avatarKey, 10 * 60)
                .catch(() => null)
            : null,
        },
      })),
    );
    return { items: withPhotos, total, page, limit, counts };
  }

  // How many drivers are in each tab, for the same search. "review" is
  // submitted and undecided; "draft" is still being filled in by the driver.
  private async driverCounts(matches: Prisma.DriverProfileWhereInput) {
    const [byStatus, review] = await Promise.all([
      this.prisma.driverProfile.groupBy({
        by: ['status'],
        where: matches,
        _count: { _all: true },
      }),
      this.prisma.driverProfile.count({
        where: { ...matches, status: 'pending', submittedAt: { not: null } },
      }),
    ]);
    const of = (s: string) =>
      byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      review,
      draft: of('pending') - review,
      approved: of('approved'),
      rejected: of('rejected'),
      suspended: of('suspended'),
    };
  }

  // Detail view: includes signed, short-lived links to the uploaded papers.
  async getDriver(id: string) {
    const profile = await this.findDriver(id);
    const { avatarKey, ...user } = profile.user;
    return {
      ...profile,
      user: {
        ...user,
        avatarUrl: avatarKey
          ? await this.storage.createSignedUrl(avatarKey, 10 * 60)
          : null,
      },
      documents: await this.documents.withUrls(profile.documents),
      missingDocuments: this.requirements.missing(
        profile.vehicles.filter((v) => v.status !== 'approved'),
        profile.documents,
      ),
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
  // grants the `driver` role, which unlocks Driver mode in the app. The
  // actual work is shared with the DEV_AUTO_APPROVE_DRIVERS dev flow - see
  // DriverApprovalService.
  async approveDriver(id: string, adminId: string) {
    await this.driverApproval.approve(id, adminId, 'driver.approve');
    return this.findDriver(id);
  }

  // `issues` say exactly what to fix; the app shows only those and keeps
  // everything else filled in, and the driver submits again once fixed.
  async rejectDriver(
    id: string,
    adminId: string,
    reason: string,
    issues: ReviewIssueDto[],
  ) {
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
          submittedAt: null,
          reviewIssues: issues.length
            ? (issues.map((i) => ({
                field: i.field,
                message: i.message,
                ...(i.vehicleId && { vehicleId: i.vehicleId }),
              })) as Prisma.InputJsonValue)
            : Prisma.DbNull,
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
      issues: issues.map((i) => i.field),
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

  // Every registered vehicle, filterable by ride/freight, type, status and a
  // search over plate, make/model and the driver. `counts` is per status for
  // the same filters (minus status), for the tabs.
  async listVehicles({
    page,
    limit,
    service,
    category,
    status,
    search,
  }: ListVehiclesDto) {
    const q = search?.trim();
    const base: Prisma.VehicleWhereInput = {
      ...(category ? { category } : {}),
      ...(service ? { categoryRef: { service } } : {}),
      ...(q
        ? {
            OR: [
              { plateNumber: { contains: q, mode: 'insensitive' } },
              { make: { contains: q, mode: 'insensitive' } },
              { model: { contains: q, mode: 'insensitive' } },
              {
                driverProfile: {
                  user: {
                    OR: [
                      { name: { contains: q, mode: 'insensitive' } },
                      { phone: { contains: q } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const where = status ? { ...base, status } : base;
    const [rows, total, grouped] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          categoryRef: {
            select: { label: true, service: true, iconKey: true },
          },
          driverProfile: {
            select: {
              id: true,
              status: true,
              user: { select: { id: true, name: true, phone: true } },
            },
          },
          documents: {
            where: { type: 'vehicle_photo' },
            select: { storageKey: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
    ]);
    const items = await Promise.all(
      rows.map(async ({ documents, categoryRef, driverProfile, ...v }) => ({
        ...v,
        // Tiers it meets (ticked for the admin) and every tier of its type.
        suggestedTiers: await this.tiers.suggestFor(v),
        availableTiers: (await this.tiers.tiersOf(v.category)).map((c) => ({
          key: c.key,
          open: isOpenTier(c),
        })),
        categoryLabel: categoryRef.label,
        service: categoryRef.service,
        iconKey: categoryRef.iconKey,
        driver: {
          profileId: driverProfile.id,
          status: driverProfile.status,
          userId: driverProfile.user.id,
          name: driverProfile.user.name,
          phone: driverProfile.user.phone,
        },
        // A photo that can not be signed shows as missing, not as an error
        // for the whole list.
        photoUrl: documents[0]
          ? await this.storage
              .createSignedUrl(documents[0].storageKey, 10 * 60)
              .catch(() => null)
          : null,
      })),
    );
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return { items, total, page, limit, counts };
  }

  async setVehicleStatus(
    id: string,
    status: 'approved' | 'rejected',
    actorId: string,
    tiers?: string[],
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
    if (tiers) await this.tiers.assertTiersOf(vehicle.category, tiers);
    await this.prisma.vehicle.update({
      where: { id },
      data: { status, ...(tiers && { tiers }) },
    });
    // Approved without a choice: the tiers it meets.
    if (status === 'approved' && !tiers) {
      await this.tiers.applySuggestion([id]);
    }
    await this.audit.log(
      actorId,
      `vehicle.${status === 'approved' ? 'approve' : 'reject'}`,
      'vehicle',
      id,
      tiers ? { tiers } : undefined,
    );
    await this.tiers.refreshOnline({ vehicleId: id });
    return this.prisma.vehicle.findUniqueOrThrow({ where: { id } });
  }

  // The admin changes which tiers (AC, Business...) a vehicle may take.
  async setVehicleTiers(id: string, tiers: string[], actorId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    await this.tiers.assertTiersOf(vehicle.category, tiers);
    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { tiers: [...new Set(tiers)] },
    });
    await this.audit.log(actorId, 'vehicle.tiers', 'vehicle', id, {
      before: vehicle.tiers,
      after: updated.tiers,
    });
    await this.tiers.refreshOnline({ vehicleId: id });
    return updated;
  }
}
