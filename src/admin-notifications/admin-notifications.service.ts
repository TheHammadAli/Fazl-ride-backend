import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NewAdminNotification {
  type: string;
  title: string;
  body: string;
  targetType?: string;
  targetId?: string;
}

// The admin panel's notification bell: things waiting for an admin.
@Injectable()
export class AdminNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(notification: NewAdminNotification) {
    return this.prisma.adminNotification.create({ data: notification });
  }

  async list(limit = 30) {
    const [items, unread] = await Promise.all([
      this.prisma.adminNotification.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.adminNotification.count({ where: { readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(id: string) {
    const { count } = await this.prisma.adminNotification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
    if (!count) {
      const exists = await this.prisma.adminNotification.count({
        where: { id },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { ok: true };
  }

  async markAllRead() {
    await this.prisma.adminNotification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
