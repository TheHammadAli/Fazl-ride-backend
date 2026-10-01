import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListRidesDto } from './dto/admin-rides.dto.js';
import { ratingView } from './rating.js';

const person = { select: { id: true, name: true, phone: true } } as const;

@Injectable()
export class AdminRidesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListRidesDto) {
    const where: Prisma.RideWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.category && { category: q.category }),
      ...(q.tripType && { tripType: q.tripType }),
      ...(q.passengerId && { passengerId: q.passengerId }),
      ...(q.driverId && { driverId: q.driverId }),
      ...((q.from || q.to) && {
        requestedAt: {
          ...(q.from && { gte: new Date(q.from) }),
          ...(q.to && { lte: new Date(q.to) }),
        },
      }),
    };
    const [rides, total] = await Promise.all([
      this.prisma.ride.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { passenger: person, driver: person },
      }),
      this.prisma.ride.count({ where }),
    ]);
    return {
      items: rides.map((r) => ({
        id: r.id,
        status: r.status,
        category: r.category,
        tripType: r.tripType,
        pickupAddress: r.pickupAddress,
        dropoffAddress: r.dropoffAddress,
        estimatedFare: r.estimatedFare,
        fare: r.fare,
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        cancelledBy: r.cancelledBy,
        cancelledFromStatus: r.cancelledFromStatus,
        requestedAt: r.requestedAt,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
        passenger: r.passenger,
        driver: r.driver,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  // Everything about one ride, for support and disputes.
  async get(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        passenger: {
          select: {
            id: true,
            name: true,
            phone: true,
            ratingSum: true,
            ratingCount: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            ratingSum: true,
            ratingCount: true,
          },
        },
        vehicle: true,
        offers: { orderBy: { offeredAt: 'asc' } },
        ratings: { orderBy: { createdAt: 'asc' } },
        cancellationLog: { orderBy: { createdAt: 'asc' } },
        earningEntries: true,
      },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return {
      ...ride,
      passenger: {
        ...ride.passenger,
        rating: ratingView(
          ride.passenger.ratingSum,
          ride.passenger.ratingCount,
        ),
      },
      driver: ride.driver
        ? {
            ...ride.driver,
            rating: ratingView(ride.driver.ratingSum, ride.driver.ratingCount),
          }
        : null,
    };
  }
}
