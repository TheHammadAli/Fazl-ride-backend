import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { VehicleCategory } from '../generated/prisma/client.js';
import {
  CreateVehicleCategoryDto,
  UpdateVehicleCategoryDto,
} from './dto/vehicle-category.dto.js';

export { KNOWN_VEHICLE_ICON_KEYS } from './vehicle-icons.js';

// Cached briefly: this is read on essentially every ride/vehicle/presence
// request, and categories change rarely (an admin action, not per-request).
const CACHE_MS = 30_000;

@Injectable()
export class VehicleCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private cache: { at: number; rows: VehicleCategory[] } | null = null;

  private async allCached(): Promise<VehicleCategory[]> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      const rows = await this.prisma.vehicleCategory.findMany({
        orderBy: { sortOrder: 'asc' },
      });
      this.cache = { at: now, rows };
    }
    return this.cache.rows;
  }

  private invalidate() {
    this.cache = null;
  }

  // What passengers/drivers see: only the ones open for business right now.
  async listActive(): Promise<VehicleCategory[]> {
    return (await this.allCached()).filter((c) => c.active);
  }

  // Admin's own list: everything, so a deactivated category can be found again.
  listAll() {
    return this.prisma.vehicleCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  // The active category with this key, or null.
  async findActive(key: string): Promise<VehicleCategory | null> {
    return (await this.listActive()).find((c) => c.key === key) ?? null;
  }

  // Throws if `key` is not a category a passenger/driver can use right now.
  async assertActive(key: string): Promise<void> {
    const active = await this.listActive();
    if (!active.some((c) => c.key === key)) {
      throw new BadRequestException(
        `Unknown or inactive vehicle category: ${key}`,
      );
    }
  }

  async create(dto: CreateVehicleCategoryDto, actorId: string) {
    const existing = await this.prisma.vehicleCategory.findUnique({
      where: { key: dto.key },
    });
    if (existing) {
      throw new ConflictException(
        `Vehicle category "${dto.key}" already exists`,
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const category = await tx.vehicleCategory.create({
        data: {
          key: dto.key,
          label: dto.label,
          iconKey: dto.iconKey,
          service: dto.service ?? 'ride',
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await tx.fareConfig.create({
        data: {
          category: dto.key,
          baseFare: dto.fare.baseFare,
          perKm: dto.fare.perKm,
          perMinute: dto.fare.perMinute,
          minimumFare: dto.fare.minimumFare,
        },
      });
      return category;
    });
    this.invalidate();
    await this.audit.log(
      actorId,
      'vehicle_category.create',
      'vehicle_category',
      dto.key,
      JSON.parse(JSON.stringify(dto)),
    );
    return created;
  }

  async update(key: string, dto: UpdateVehicleCategoryDto, actorId: string) {
    const existing = await this.prisma.vehicleCategory.findUnique({
      where: { key },
    });
    if (!existing) {
      throw new BadRequestException(`Unknown vehicle category: ${key}`);
    }
    const updated = await this.prisma.vehicleCategory.update({
      where: { key },
      data: dto,
    });
    this.invalidate();
    await this.audit.log(
      actorId,
      'vehicle_category.update',
      'vehicle_category',
      key,
      {
        before: {
          label: existing.label,
          iconKey: existing.iconKey,
          active: existing.active,
          sortOrder: existing.sortOrder,
          service: existing.service,
        },
        changes: JSON.parse(JSON.stringify(dto)),
      },
    );
    return updated;
  }
}
