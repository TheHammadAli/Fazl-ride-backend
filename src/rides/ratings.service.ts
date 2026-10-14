import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateRideDto } from './dto/rate-ride.dto.js';
import { RideSettings } from './rides.settings.js';

@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: RideSettings,
    private readonly events: DomainEvents,
  ) {}

  // The passenger rates the driver and the driver rates the passenger, once each,
  // for a completed ride and within the rating window.
  async rate(userId: string, rideId: string, dto: RateRideDto) {
    const ride = await this.prisma.ride.findFirst({
      where: {
        id: rideId,
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.status !== 'completed' || !ride.completedAt) {
      throw new ConflictException('Only completed rides can be rated');
    }
    const deadline =
      ride.completedAt.getTime() + this.settings.ratingWindowDays * 86_400_000;
    if (Date.now() > deadline) {
      throw new ConflictException('The time to rate this ride has passed');
    }
    const rateeId =
      ride.passengerId === userId ? ride.driverId : ride.passengerId;
    if (!rateeId) throw new ConflictException('This ride has nobody to rate');
    // "AC did not work" only means something from the customer on an AC tier.
    const acIssue =
      dto.acIssue === true &&
      ride.passengerId === userId &&
      ride.vehicleId != null &&
      (
        await this.prisma.vehicleCategory.findUnique({
          where: { key: ride.category },
          select: { requiresAc: true },
        })
      )?.requiresAc === true;

    try {
      await this.prisma.$transaction([
        this.prisma.rideRating.create({
          data: {
            rideId,
            raterId: userId,
            rateeId,
            stars: dto.stars,
            comment: dto.comment,
            acIssue,
          },
        }),
        this.prisma.user.update({
          where: { id: rateeId },
          data: {
            ratingSum: { increment: dto.stars },
            ratingCount: { increment: 1 },
          },
        }),
      ]);
    } catch (error: any) {
      if (error?.code === 'P2002')
        throw new ConflictException('You already rated this ride');
      throw error;
    }
    this.events.emit('ride.rated', {
      rideId,
      raterId: userId,
      rateeId,
      stars: dto.stars,
    });
    if (acIssue && ride.vehicleId) await this.countAcReports(ride.vehicleId);
    return { rideId, stars: dto.stars, comment: dto.comment ?? null };
  }

  // Every third "AC did not work" for a vehicle in 30 days alerts the admins.
  private async countAcReports(vehicleId: string) {
    const reports = await this.prisma.rideRating.count({
      where: {
        acIssue: true,
        createdAt: { gt: new Date(Date.now() - 30 * 86_400_000) },
        ride: { vehicleId },
      },
    });
    if (reports > 0 && reports % 3 === 0) {
      this.events.emit('vehicle.ac_reported', { vehicleId, reports });
    }
  }

  mine(rideId: string, userId: string) {
    return this.prisma.rideRating.findUnique({
      where: { rideId_raterId: { rideId, raterId: userId } },
      select: { stars: true, comment: true },
    });
  }
}
