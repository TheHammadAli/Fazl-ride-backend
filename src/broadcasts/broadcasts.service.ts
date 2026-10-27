import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DevicesService } from '../push/devices.service.js';
import type { BroadcastAudience, SendBroadcastDto } from './broadcasts.dto.js';

// One broadcast a minute: a second click (or two admins at once) must not
// ring every phone twice.
const MIN_GAP_MS = 60_000;

const AUDIENCE_LABEL: Record<BroadcastAudience, string> = {
  all: 'Everyone',
  passengers: 'Passengers',
  drivers: 'Drivers',
  online_drivers: 'Drivers online now',
};

// Admin push messages to a group of users (Notifications page).
@Injectable()
export class BroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
  ) {}

  private async audienceWhere(
    audience: BroadcastAudience,
  ): Promise<Prisma.UserWhereInput> {
    const active: Prisma.UserWhereInput = { status: 'active' };
    switch (audience) {
      case 'drivers':
        return { ...active, roles: { some: { role: 'driver' } } };
      case 'passengers':
        return { ...active, roles: { none: { role: 'driver' } } };
      case 'online_drivers': {
        const online = await this.prisma.driverPresence.findMany({
          where: { isOnline: true },
          select: { userId: true },
        });
        return {
          ...active,
          roles: { some: { role: 'driver' } },
          id: { in: online.map((o) => o.userId) },
        };
      }
      default:
        return active;
    }
  }

  // How many people are in each group and how many of them have the app on
  // a phone (only those get it), for the composer.
  async audiences() {
    const keys = Object.keys(AUDIENCE_LABEL) as BroadcastAudience[];
    const rows = await Promise.all(
      keys.map(async (key) => {
        const where = await this.audienceWhere(key);
        const [people, reachable] = await Promise.all([
          this.prisma.user.count({ where }),
          this.prisma.user.count({
            where: { ...where, devices: { some: {} } },
          }),
        ]);
        return { key, label: AUDIENCE_LABEL[key], people, reachable };
      }),
    );
    return { items: rows };
  }

  async send(adminId: string, dto: SendBroadcastDto) {
    const last = await this.prisma.broadcast.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && Date.now() - last.createdAt.getTime() < MIN_GAP_MS) {
      throw new HttpException(
        'A broadcast went out less than a minute ago. Wait a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const users = await this.prisma.user.findMany({
      where: await this.audienceWhere(dto.audience),
      select: { id: true },
    });
    const title = dto.title.trim();
    const body = dto.body.trim();
    const devices = await this.devices.notify(
      users.map((u) => u.id),
      {
        title,
        body,
        data: { type: 'broadcast' },
        channel: 'general',
      },
    );
    const row = await this.prisma.broadcast.create({
      data: {
        title,
        body,
        audience: dto.audience,
        adminId,
        people: users.length,
        devices,
      },
    });
    await this.audit.log(adminId, 'broadcast.send', 'broadcast', row.id, {
      audience: dto.audience,
      people: users.length,
      devices,
    });
    return this.view(row);
  }

  async list(page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.broadcast.count(),
    ]);
    // Who sent each, by name or email.
    const admins = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((b) => b.adminId))] } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(admins.map((a) => [a.id, a.name ?? a.email]));
    return {
      items: items.map((b) => ({
        ...this.view(b),
        sentBy: byId.get(b.adminId) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  private view(b: {
    id: string;
    title: string;
    body: string;
    audience: string;
    people: number;
    devices: number;
    createdAt: Date;
  }) {
    return {
      id: b.id,
      title: b.title,
      body: b.body,
      audience: b.audience,
      audienceLabel:
        AUDIENCE_LABEL[b.audience as BroadcastAudience] ?? b.audience,
      people: b.people,
      devices: b.devices,
      createdAt: b.createdAt,
    };
  }
}
