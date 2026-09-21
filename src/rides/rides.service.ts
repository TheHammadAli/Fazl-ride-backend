import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DomainEvents } from '../events/domain-events.service.js';
import { VehicleCategory } from '../generated/prisma/enums.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CancelRideDto, RequestRideDto } from './dto/request-ride.dto.js';
import { FaresService } from './fares.service.js';
import { MatchingService } from './matching.service.js';
import {
  presentRide,
  rideInclude,
  RideWithRelations,
} from './ride.presenter.js';
import { RoutingProvider } from './routing/routing.provider.js';
import { RideSettings } from './rides.settings.js';

const IN_PROGRESS = ['requested', 'accepted', 'arrived', 'started'] as const;
const DRIVER_ACTIVE = ['accepted', 'arrived', 'started'] as const;

@Injectable()
export class RidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fares: FaresService,
    private readonly matching: MatchingService,
    private readonly locations: DriverLocationStore,
    private readonly routing: RoutingProvider,
    private readonly settings: RideSettings,
    private readonly events: DomainEvents,
  ) {}

  // Creates the request and immediately offers it to the nearest drivers.
  async request(passengerId: string, dto: RequestRideDto) {
    const quote = await this.fares.quote(dto.pickup, dto.dropoff, dto.category);
    const now = new Date();
    let ride: RideWithRelations;
    try {
      ride = await this.prisma.ride.create({
        data: {
          passengerId,
          category: dto.category,
          pickupLat: dto.pickup.lat,
          pickupLng: dto.pickup.lng,
          pickupAddress: dto.pickup.address,
          dropoffLat: dto.dropoff.lat,
          dropoffLng: dto.dropoff.lng,
          dropoffAddress: dto.dropoff.address,
          estimatedDistanceMeters: quote.distanceMeters,
          estimatedDurationSeconds: quote.durationSeconds,
          estimatedFare: quote.fare,
          searchRadiusMeters: this.settings.radiiMeters[0],
          nextExpandAt: new Date(
            now.getTime() + this.settings.offerTtlSeconds * 1000,
          ),
          expiresAt: new Date(
            now.getTime() + this.settings.requestTtlSeconds * 1000,
          ),
        },
        include: rideInclude,
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const active = await this.prisma.ride.findFirst({
          where: { passengerId, status: { in: [...IN_PROGRESS] } },
          select: { id: true },
        });
        throw new ConflictException({
          message: 'You already have a ride in progress',
          rideId: active?.id,
        });
      }
      throw error;
    }

    const offersSent = await this.matching.offerRide(ride);
    this.events.emit('ride.requested', {
      rideId: ride.id,
      passengerId,
      category: ride.category,
    });
    return { ...presentRide(ride), offersSent };
  }

  async activeFor(userId: string, as: 'passenger' | 'driver') {
    const ride = await this.prisma.ride.findFirst({
      where:
        as === 'passenger'
          ? { passengerId: userId, status: { in: [...IN_PROGRESS] } }
          : { driverId: userId, status: { in: [...DRIVER_ACTIVE] } },
      include: rideInclude,
    });
    return { ride: ride ? await this.view(ride) : null };
  }

  async get(userId: string, id: string) {
    const ride = await this.prisma.ride.findFirst({
      where: { id, OR: [{ passengerId: userId }, { driverId: userId }] },
      include: rideInclude,
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return this.view(ride);
  }

  // B3 covers cancelling a request nobody has accepted; later states come with B4.
  async cancel(userId: string, id: string, dto: CancelRideDto) {
    const now = new Date();
    const result = await this.prisma.ride.updateMany({
      where: { id, passengerId: userId, status: 'requested' },
      data: {
        status: 'cancelled',
        cancelledBy: 'passenger',
        cancelReason: dto.reason,
        cancelledAt: now,
      },
    });
    if (result.count === 0) {
      const existing = await this.prisma.ride.findFirst({
        where: { id, passengerId: userId },
        select: { status: true },
      });
      if (!existing) throw new NotFoundException('Ride not found');
      throw new ConflictException(
        `A ride that is ${existing.status} cannot be cancelled here`,
      );
    }
    await this.prisma.rideOffer.updateMany({
      where: { rideId: id, status: 'pending' },
      data: { status: 'expired', respondedAt: now },
    });
    this.events.emit('ride.cancelled', { rideId: id, by: 'passenger' });
    return this.get(userId, id);
  }

  // Offers waiting for this driver's answer, newest first.
  async offersFor(driverId: string) {
    const offers = await this.prisma.rideOffer.findMany({
      where: {
        driverId,
        status: 'pending',
        expiresAt: { gt: new Date() },
        ride: { status: 'requested' },
      },
      include: { ride: { include: rideInclude } },
      orderBy: { offeredAt: 'desc' },
    });
    return offers.map((offer) => ({
      offerId: offer.id,
      rideId: offer.rideId,
      expiresAt: offer.expiresAt,
      distanceToPickupMeters: offer.distanceToPickupMeters,
      etaSeconds: offer.etaSeconds,
      ride: presentRide(offer.ride),
    }));
  }

  // First driver to get here wins. Everything below runs in one transaction, so
  // a lost race (or being offline / already busy) leaves nothing half-done.
  async accept(driverId: string, rideId: string) {
    const presence = await this.prisma.driverPresence.findUnique({
      where: { userId: driverId },
    });
    if (!presence?.isOnline)
      throw new ConflictException('Go online to accept rides');

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Lock the ride first: concurrent accepts for the same ride then run one
        // after another (the loser sees it taken) instead of deadlocking on the
        // offer rows they would otherwise lock in opposite orders.
        const locked = await tx.$queryRaw<
          { category: VehicleCategory; status: string }[]
        >`SELECT "category", "status"::text AS "status" FROM rides
          WHERE "id" = ${rideId}::uuid FOR UPDATE`;
        const ride = locked[0];
        if (!ride) throw new NotFoundException('Ride not found');
        if (ride.status !== 'requested') {
          throw new ConflictException(
            'This ride was taken by another driver or cancelled',
          );
        }
        if (ride.category !== presence.category) {
          throw new ConflictException(
            "Your current vehicle does not match this ride's category",
          );
        }

        const offer = await tx.rideOffer.updateMany({
          where: {
            rideId,
            driverId,
            status: 'pending',
            expiresAt: { gt: now },
          },
          data: { status: 'accepted', respondedAt: now },
        });
        if (offer.count === 0) {
          throw new ConflictException(
            'This offer has expired or was already answered',
          );
        }

        await tx.ride.update({
          where: { id: rideId },
          data: {
            status: 'accepted',
            driverId,
            vehicleId: presence.vehicleId,
            acceptedAt: now,
          },
        });

        const busy = await tx.$executeRaw`
          UPDATE driver_presence SET "busy" = true, "updatedAt" = now()
          WHERE "userId" = ${driverId}::uuid AND "isOnline" AND NOT "busy"`;
        if (busy === 0)
          throw new ConflictException('You are already on a ride');

        await tx.rideOffer.updateMany({
          where: { rideId, status: 'pending' },
          data: { status: 'expired', respondedAt: now },
        });
      });
    } catch (error: any) {
      if (error?.code === 'P2002')
        throw new ConflictException('You are already on a ride');
      // Safety net: a lock conflict means another accept won the race.
      if (error?.code === 'P2034')
        throw new ConflictException('Please try again');
      throw error;
    }

    this.events.emit('ride.accepted', { rideId, driverId });
    return this.get(driverId, rideId);
  }

  async decline(driverId: string, rideId: string) {
    const result = await this.prisma.rideOffer.updateMany({
      where: { rideId, driverId, status: 'pending' },
      data: { status: 'declined', respondedAt: new Date() },
    });
    if (result.count === 0)
      throw new NotFoundException('No pending offer for this ride');
    this.events.emit('ride.offer.declined', { rideId, driverId });
    return { message: 'Offer declined' };
  }

  // Adds the driver's live position and pickup ETA while they are on their way.
  private async view(ride: RideWithRelations) {
    if (
      !ride.driverId ||
      !['accepted', 'arrived', 'started'].includes(ride.status)
    ) {
      return presentRide(ride);
    }
    const driverLocation = await this.locations.getLocation(ride.driverId);
    const driverEtaSeconds =
      driverLocation && ride.status === 'accepted'
        ? (
            await this.routing.route(driverLocation, {
              lat: ride.pickupLat,
              lng: ride.pickupLng,
            })
          ).durationSeconds
        : null;
    return presentRide(ride, { driverLocation, driverEtaSeconds });
  }
}
