import { Injectable, OnModuleInit } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service.js';
import {
  ActivityItem,
  ActivityProvider,
  ActivityQuery,
} from '../activity/activity.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Puts a person's finished deliveries in History (the "Deliveries" tab), matched
// by the phone number the other system sent for the customer.
@Injectable()
export class OrderActivityProvider
  extends ActivityProvider
  implements OnModuleInit
{
  readonly type = 'delivery';

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {
    super();
  }

  onModuleInit() {
    this.activity.register(this);
  }

  async list({
    phone,
    as,
    limit,
    before,
  }: ActivityQuery): Promise<ActivityItem[]> {
    // Deliveries are the customer's; the driver side has no history of them here.
    if (as === 'driver' || !phone) return [];
    const orders = await this.prisma.trackedOrder.findMany({
      where: {
        customerPhone: phone,
        status: { terminal: true },
        ...(before && {
          OR: [
            { updatedAt: { lt: before.at } },
            { updatedAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      include: { status: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return orders.map((o) => ({
      id: o.id,
      type: 'delivery',
      title: `Order ${o.externalId}`,
      subtitle: o.deliveryAddress || null,
      occurredAt: o.updatedAt,
      status: o.status.key,
      amount: null,
      myRating: null,
      ref: { module: 'orders', id: o.id },
    }));
  }
}
