import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateStatusDto, UpdateStatusDto } from './dto/admin-order.dto.js';
import { nameConflicts, normalizeStatusName } from './status-resolver.js';

// The steps an order moves through, editable by an admin.
@Injectable()
export class OrderStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  all() {
    return this.prisma.orderStatus.findMany({ orderBy: { position: 'asc' } });
  }

  async firstActive() {
    const first = await this.prisma.orderStatus.findFirst({
      where: { active: true, terminal: false },
      orderBy: { position: 'asc' },
    });
    if (!first) throw new ConflictException('No order status is configured');
    return first;
  }

  async create(dto: CreateStatusDto, adminId: string) {
    const aliases = (dto.aliases ?? []).map(normalizeStatusName);
    await this.assertNoConflict(dto.key, aliases);
    const created = await this.prisma.orderStatus
      .create({
        data: {
          key: dto.key,
          label: dto.label,
          position: dto.position,
          terminal: dto.terminal ?? false,
          aliases,
        },
      })
      .catch((error: any) => {
        if (error?.code === 'P2002')
          throw new ConflictException('A status with this key already exists');
        throw error;
      });
    await this.audit.log(
      adminId,
      'order_status.create',
      'order_status',
      created.key,
      Object.fromEntries(Object.entries(dto)),
    );
    return created;
  }

  async update(key: string, dto: UpdateStatusDto, adminId: string) {
    const existing = await this.prisma.orderStatus.findUnique({
      where: { key },
    });
    if (!existing) throw new NotFoundException('Status not found');

    if (dto.aliases) {
      dto.aliases = dto.aliases.map(normalizeStatusName);
      await this.assertNoConflict(key, dto.aliases);
    }
    if (dto.active === false && existing.active) {
      // Switching a step off while orders sit in it would leave them in a state nobody can name.
      const inUse = await this.prisma.trackedOrder.count({
        where: { statusKey: key },
      });
      if (inUse > 0) {
        throw new ConflictException(
          `${inUse} order(s) are in this status; move them first`,
        );
      }
    }
    const updated = await this.prisma.orderStatus.update({
      where: { key },
      data: dto,
    });
    await this.audit.log(adminId, 'order_status.update', 'order_status', key, {
      before: JSON.parse(JSON.stringify(existing)),
      changes: Object.fromEntries(Object.entries(dto)),
    });
    return updated;
  }

  private async assertNoConflict(key: string, aliases: string[]) {
    const conflicts = nameConflicts(key, aliases, await this.all());
    if (conflicts.length) {
      throw new ConflictException(
        `Already used by another status: ${[...new Set(conflicts)].join(', ')}`,
      );
    }
  }
}
