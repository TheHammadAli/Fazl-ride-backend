import { Injectable, OnModuleInit } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service.js';
import {
  ActivityItem,
  ActivityProvider,
  ActivityQuery,
} from '../activity/activity.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Adds finished rides (completed or cancelled) to History.
@Injectable()
export class RideActivityProvider
  extends ActivityProvider
  implements OnModuleInit
{
  readonly type = 'ride';

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
    userId,
    as,
    limit,
    before,
  }: ActivityQuery): Promise<ActivityItem[]> {
    const side = as === 'driver' ? 'driverId' : 'passengerId';
    // Pick ids in time order first: a ride's time is when it completed or was cancelled.
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM rides
       WHERE "${side}" = $1::uuid
         AND status IN ('completed', 'cancelled')
         AND ($2::timestamptz IS NULL
              OR COALESCE("completedAt", "cancelledAt") < $2::timestamptz
              OR (COALESCE("completedAt", "cancelledAt") = $2::timestamptz AND id::text < $3))
       ORDER BY COALESCE("completedAt", "cancelledAt") DESC, id DESC
       LIMIT $4::int`,
      userId,
      before?.at ?? null,
      before?.id ?? '',
      limit,
    );
    if (!rows.length) return [];

    const ids = rows.map((r) => r.id);
    const [rides, ratings] = await Promise.all([
      this.prisma.ride.findMany({ where: { id: { in: ids } } }),
      this.prisma.rideRating.findMany({
        where: { rideId: { in: ids }, raterId: userId },
        select: { rideId: true, stars: true },
      }),
    ]);
    const byId = new Map(rides.map((r) => [r.id, r]));
    const stars = new Map(ratings.map((r) => [r.rideId, r.stars]));

    return ids.map((id) => {
      const ride = byId.get(id)!;
      return {
        id: ride.id,
        type: 'ride',
        title: `${ride.pickupAddress} → ${ride.dropoffAddress}`,
        subtitle: ride.category,
        occurredAt: (ride.completedAt ??
          ride.cancelledAt ??
          ride.updatedAt) as Date,
        status: ride.status,
        amount:
          ride.fare != null ? { value: ride.fare, currency: 'PKR' } : null,
        myRating: stars.get(ride.id) ?? null,
        ref: { module: 'rides', id: ride.id },
      };
    });
  }
}
