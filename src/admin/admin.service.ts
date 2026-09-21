import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { DriverDocumentsService } from '../drivers/driver-documents.service.js';
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
    return this.findDriver(id);
  }

  async setVehicleStatus(id: string, status: 'approved' | 'rejected') {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return this.prisma.vehicle.update({ where: { id }, data: { status } });
  }
}
