import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListOrdersDto } from './dto/admin-order.dto.js';
import { OrdersService } from './orders.service.js';

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async list(q: ListOrdersDto) {
    const where: Prisma.TrackedOrderWhereInput = {
      ...(q.status && { statusKey: q.status }),
      ...(q.q && { externalId: { contains: q.q, mode: 'insensitive' } }),
      ...(q.customerRef && { customerRef: q.customerRef }),
      ...(q.deliveryPersonId && { deliveryPersonId: q.deliveryPersonId }),
      ...((q.from || q.to) && {
        createdAt: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: new Date(q.to) }),
        },
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.trackedOrder.findMany({
        where,
        include: {
          status: { select: { key: true, label: true, terminal: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.trackedOrder.count({ where }),
    ]);
    return {
      items: items.map((o) => ({
        id: o.id,
        source: o.source,
        orderId: o.externalId,
        status: o.status,
        customerRef: o.customerRef,
        deliveryAddress: o.deliveryAddress,
        deliveryPerson: o.deliveryPersonName
          ? { id: o.deliveryPersonId, name: o.deliveryPersonName }
          : null,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  // Everything, including what the customer never sees, for support and disputes.
  async get(id: string) {
    const order = await this.prisma.trackedOrder.findUnique({
      where: { id },
      include: {
        status: true,
        events: {
          orderBy: { at: 'asc' },
          include: { status: { select: { label: true } } },
        },
        points: { orderBy: { at: 'asc' }, take: 1000 },
        tokens: {
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return { ...order, customerView: await this.orders.viewById(id) };
  }
}
