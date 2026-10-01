import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CancellationsService } from '../cancellations/cancellations.service.js';
import { haversineMeters } from '../common/geo.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { RideStatus, TripType } from '../generated/prisma/enums.js';
import { DriverLocationStore } from '../presence/driver-location.store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CancelRideDto, RequestRideDto } from './dto/request-ride.dto.js';
import { calculateFare } from './fare.calculator.js';
import { EarningsService } from '../earnings/earnings.service.js';
import { FaresService } from './fares.service.js';
import { MatchingService } from './matching.service.js';
import {
  presentRide,
  rideInclude,
  RideWithRelations,
} from './ride.presenter.js';
import { ratingView } from './rating.js';
import { RatingsService } from './ratings.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { StorageService } from '../storage/storage.service.js';
import { RideSettings } from './rides.settings.js';
import { billedDistanceMeters, FareRatesSnapshot } from './trip-distance.js';
import { VehicleCategoriesService } from '../vehicle-categories/vehicle-categories.service.js';

const IN_PROGRESS: RideStatus[] = [
  'requested',
  'accepted',
  'arrived',
  'started',
];
const DRIVER_ACTIVE: RideStatus[] = ['accepted', 'arrived', 'started'];

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
    private readonly cancellations: CancellationsService,
    private readonly ratings: RatingsService,
    private readonly earnings: EarningsService,
    private readonly vehicleCategories: VehicleCategoriesService,
    private readonly storage: StorageService,
  ) {}

  // The lowest a negotiable price may go for a ride whose fixed/estimated
  // fare is `estimatedFare` - it can be talked down, but not given away.
  private minNegotiableFare(estimatedFare: number): number {
    return Math.max(
      1,
      Math.round(estimatedFare * this.settings.negotiationMinFareFraction),
    );
  }

  private assertAboveMinimumFare(amount: number, estimatedFare: number) {
    const min = this.minNegotiableFare(estimatedFare);
    if (amount < min) {
      throw new BadRequestException(
        `The price can not be lower than Rs ${min} (the fixed rate is Rs ${estimatedFare})`,
      );
    }
  }

  // Creates the request and immediately offers it to the nearest drivers (or,
  // in bidding mode, broadcasts it to everyone in range).
  async request(passengerId: string, dto: RequestRideDto) {
    await this.cancellations.assertNotBlocked(passengerId, 'passenger');
    await this.vehicleCategories.assertActive(dto.category);
    const tripType = dto.tripType ?? TripType.within_city;
    const quote = await this.fares.quote(
      dto.pickup,
      dto.dropoff,
      dto.category,
      tripType,
    );
    const negotiable = this.settings.pricingMode === 'bidding';
    if (negotiable && dto.offeredFare != null) {
      this.assertAboveMinimumFare(dto.offeredFare, quote.fare);
    }
    const now = new Date();
    let ride: RideWithRelations;
    try {
      ride = await this.prisma.ride.create({
        data: {
          passengerId,
          category: dto.category,
          tripType,
          pickupLat: dto.pickup.lat,
          pickupLng: dto.pickup.lng,
          pickupAddress: dto.pickup.address,
          dropoffLat: dto.dropoff.lat,
          dropoffLng: dto.dropoff.lng,
          dropoffAddress: dto.dropoff.address,
          estimatedDistanceMeters: quote.distanceMeters,
          estimatedDurationSeconds: quote.durationSeconds,
          estimatedFare: quote.fare,
          negotiable,
          offeredFare: negotiable ? (dto.offeredFare ?? quote.fare) : null,
          autoAccept: negotiable ? (dto.autoAccept ?? false) : false,
          rates: quote.rates,
          searchRadiusMeters: negotiable
            ? this.settings.negotiableRadiusMeters
            : this.settings.radiiMeters[0],
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
          where: { passengerId, status: { in: IN_PROGRESS } },
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
          ? { passengerId: userId, status: { in: IN_PROGRESS } }
          : { driverId: userId, status: { in: DRIVER_ACTIVE } },
      include: rideInclude,
    });
    return { ride: ride ? await this.view(ride, userId) : null };
  }

  async get(userId: string, id: string) {
    const ride = await this.prisma.ride.findFirst({
      where: { id, OR: [{ passengerId: userId }, { driverId: userId }] },
      include: rideInclude,
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return this.view(ride, userId);
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
    return offers.map((offer) => this.presentOffer(offer));
  }

  // One pending offer, in the same shape as the list, or null if it is gone.
  async offerFor(driverId: string, rideId: string) {
    const offer = await this.prisma.rideOffer.findFirst({
      where: {
        driverId,
        rideId,
        status: 'pending',
        expiresAt: { gt: new Date() },
        ride: { status: 'requested' },
      },
      include: { ride: { include: rideInclude } },
    });
    return offer ? this.presentOffer(offer) : null;
  }

  // Drivers who were asked about this ride (except one), so they can be told it is gone.
  async offeredDriverIds(rideId: string, exceptDriverId?: string) {
    const offers = await this.prisma.rideOffer.findMany({
      where: {
        rideId,
        ...(exceptDriverId && { driverId: { not: exceptDriverId } }),
      },
      select: { driverId: true },
    });
    return offers.map((o) => o.driverId);
  }

  // The passenger and the assigned driver of a ride (the only people who may see it).
  async partiesOf(rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { passengerId: true, driverId: true },
    });
    if (!ride) return null;
    return ride.driverId
      ? [ride.passengerId, ride.driverId]
      : [ride.passengerId];
  }

  // The trip a driver is on right now, for streaming their position to the passenger.
  async activeTripOf(driverId: string) {
    const ride = await this.prisma.ride.findFirst({
      where: { driverId, status: { in: [...DRIVER_ACTIVE] } },
      select: {
        id: true,
        passengerId: true,
        status: true,
        pickupLat: true,
        pickupLng: true,
      },
    });
    return ride ? { rideId: ride.id, ...ride } : null;
  }

  private presentOffer(offer: {
    id: string;
    rideId: string;
    expiresAt: Date;
    distanceToPickupMeters: number;
    etaSeconds: number;
    ride: RideWithRelations;
  }) {
    return {
      offerId: offer.id,
      rideId: offer.rideId,
      expiresAt: offer.expiresAt,
      distanceToPickupMeters: offer.distanceToPickupMeters,
      etaSeconds: offer.etaSeconds,
      ride: presentRide(offer.ride),
    };
  }

  // First driver to get here wins. Everything below runs in one transaction, so
  // a lost race (or being offline / already busy) leaves nothing half-done.
  async accept(driverId: string, rideId: string) {
    await this.cancellations.assertNotBlocked(driverId, 'driver');
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
        const ride = await this.lockRide(tx, rideId);
        if (ride.status !== 'requested') {
          throw new ConflictException(
            'This ride was taken by another driver or cancelled',
          );
        }
        if (ride.negotiable) {
          throw new ConflictException(
            'This ride is negotiable; send a bid instead of accepting directly',
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
      where: { rideId, driverId, status: { in: ['pending', 'bid'] } },
      data: { status: 'declined', respondedAt: new Date() },
    });
    if (result.count === 0)
      throw new NotFoundException('No pending offer for this ride');
    this.events.emit('ride.offer.declined', { rideId, driverId });
    return { message: 'Offer declined' };
  }

  // Driver: answers a negotiable ride with a price (their own, or the ride's
  // offeredFare again to take it as it stood). The passenger chooses among
  // these; nothing is decided yet.
  async bid(driverId: string, rideId: string, amount: number) {
    await this.cancellations.assertNotBlocked(driverId, 'driver');
    const now = new Date();
    const offer = await this.prisma.rideOffer.findFirst({
      where: {
        rideId,
        driverId,
        status: 'pending',
        expiresAt: { gt: now },
        ride: { status: 'requested', negotiable: true },
      },
      include: {
        ride: {
          select: {
            passengerId: true,
            offeredFare: true,
            autoAccept: true,
            estimatedFare: true,
          },
        },
      },
    });
    if (!offer) {
      throw new ConflictException(
        'This offer has expired or was already answered',
      );
    }
    this.assertAboveMinimumFare(amount, offer.ride.estimatedFare);
    await this.prisma.rideOffer.update({
      where: { id: offer.id },
      data: { status: 'bid', bidAmount: amount, respondedAt: now },
    });
    this.events.emit('ride.bid.received', { rideId, driverId });

    // "Automatically accept the nearest driver for RsX": the first bid at or
    // below the asking price is chosen right away.
    const withinBudget =
      offer.ride.offeredFare != null && amount <= offer.ride.offeredFare;
    if (offer.ride.autoAccept && withinBudget) {
      try {
        await this.choose(offer.ride.passengerId, rideId, offer.id);
        return { message: 'Your offer was accepted automatically' };
      } catch {
        // Someone else was already chosen a moment earlier; the bid still
        // stands and the passenger can pick it by hand instead.
      }
    }
    return { message: 'Your offer was sent to the passenger' };
  }

  // While still waiting: raise/lower the asking price, or flip auto-accept.
  // Drivers who have not answered yet see the new price on their next look;
  // ones already offered are pushed a fresh copy over the socket.
  async updateOffer(
    passengerId: string,
    rideId: string,
    changes: { amount?: number; autoAccept?: boolean },
  ) {
    if (changes.amount != null) {
      const ride = await this.prisma.ride.findFirst({
        where: {
          id: rideId,
          passengerId,
          status: 'requested',
          negotiable: true,
        },
        select: { estimatedFare: true },
      });
      if (!ride) {
        throw new ConflictException(
          'This ride is not waiting for a price update',
        );
      }
      this.assertAboveMinimumFare(changes.amount, ride.estimatedFare);
    }
    const result = await this.prisma.ride.updateMany({
      where: { id: rideId, passengerId, status: 'requested', negotiable: true },
      data: {
        ...(changes.amount != null && { offeredFare: changes.amount }),
        ...(changes.autoAccept != null && { autoAccept: changes.autoAccept }),
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'This ride is not waiting for a price update',
      );
    }
    this.events.emit('ride.offer.updated', { rideId });
    return this.get(passengerId, rideId);
  }

  // Drivers whose offer is still open and unanswered, so they can be sent a
  // refreshed copy of the ride when the passenger changes the price.
  async pendingDriverIds(rideId: string) {
    const offers = await this.prisma.rideOffer.findMany({
      where: { rideId, status: 'pending', expiresAt: { gt: new Date() } },
      select: { driverId: true },
    });
    return offers.map((o) => o.driverId);
  }

  // The open offers/bids a negotiable ride has collected so far, newest first.
  async bidsFor(passengerId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({
      where: { id: rideId, passengerId },
      select: { status: true, offeredFare: true, negotiable: true },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (!ride.negotiable) return { offers: [] };

    const offers = await this.prisma.rideOffer.findMany({
      where: {
        rideId,
        status: { in: ['pending', 'bid'] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { offeredAt: 'desc' },
    });
    return { offers: await this.presentOffers(offers, ride.offeredFare) };
  }

  // One driver's current offer on a negotiable ride, for the socket push the
  // moment they answer. `null` if it is gone (declined, expired) by the time we look.
  async bidFor(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { offeredFare: true },
    });
    if (!ride) return null;
    const offer = await this.prisma.rideOffer.findFirst({
      where: {
        rideId,
        driverId,
        status: { in: ['pending', 'bid'] },
        expiresAt: { gt: new Date() },
      },
    });
    if (!offer) return null;
    const [presented] = await this.presentOffers([offer], ride.offeredFare);
    return presented;
  }

  private async presentOffers(
    offers: {
      id: string;
      driverId: string;
      status: string;
      bidAmount: number | null;
      etaSeconds: number;
      distanceToPickupMeters: number;
    }[],
    offeredFare: number | null,
  ) {
    if (!offers.length) return [];
    const driverIds = offers.map((o) => o.driverId);
    const [drivers, presences] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: driverIds } },
        select: {
          id: true,
          name: true,
          avatarKey: true,
          ratingSum: true,
          ratingCount: true,
        },
      }),
      this.prisma.driverPresence.findMany({
        where: { userId: { in: driverIds } },
        select: { userId: true, vehicleId: true },
      }),
    ]);
    const vehicleIds = presences.map((p) => p.vehicleId).filter((v) => v);
    const vehicles = vehicleIds.length
      ? await this.prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: {
            id: true,
            make: true,
            model: true,
            color: true,
            plateNumber: true,
            category: true,
          },
        })
      : [];
    const driverById = new Map(drivers.map((d) => [d.id, d]));
    const vehicleIdByDriver = new Map(
      presences.map((p) => [p.userId, p.vehicleId]),
    );
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
    const avatarUrlByDriver = new Map(
      await Promise.all(
        drivers.map(
          async (d) => [d.id, await this.avatarUrl(d.avatarKey)] as const,
        ),
      ),
    );

    return offers.map((offer) => {
      const driver = driverById.get(offer.driverId);
      const vehicleId = vehicleIdByDriver.get(offer.driverId);
      const vehicle = vehicleId ? vehicleById.get(vehicleId) : undefined;
      return {
        offerId: offer.id,
        amount: offer.bidAmount ?? offeredFare,
        // The driver has not answered yet; this is only the suggested price.
        isPending: offer.status === 'pending',
        etaSeconds: offer.etaSeconds,
        distanceToPickupMeters: offer.distanceToPickupMeters,
        driver: driver
          ? {
              id: driver.id,
              name: driver.name,
              avatarUrl: avatarUrlByDriver.get(driver.id) ?? null,
              rating: ratingView(driver.ratingSum, driver.ratingCount),
              vehicle: vehicle ?? null,
            }
          : null,
      };
    });
  }

  // Passenger: picks one of the offers/bids. Everyone else's is closed.
  async choose(passengerId: string, rideId: string, offerId: string) {
    const now = new Date();
    let driverId = '';
    await this.prisma.$transaction(async (tx) => {
      const ride = await this.lockRide(tx, rideId);
      if (ride.passengerId !== passengerId) {
        throw new NotFoundException('Ride not found');
      }
      if (!ride.negotiable) {
        throw new ConflictException('This ride is not negotiable');
      }
      if (ride.status !== 'requested') {
        throw new ConflictException(
          'This ride is no longer waiting for a driver',
        );
      }

      const offer = await tx.rideOffer.findFirst({
        where: {
          id: offerId,
          rideId,
          status: { in: ['pending', 'bid'] },
          expiresAt: { gt: now },
        },
      });
      if (!offer) {
        throw new ConflictException('This offer is no longer available');
      }
      driverId = offer.driverId;
      const amount = offer.bidAmount ?? ride.offeredFare;
      if (amount == null) {
        // Should not happen: a negotiable ride always has an offeredFare.
        throw new ConflictException('This offer has no price');
      }

      const presence = await tx.driverPresence.findUnique({
        where: { userId: driverId },
      });
      if (!presence?.isOnline) {
        throw new ConflictException('This driver is no longer online');
      }

      await tx.rideOffer.update({
        where: { id: offerId },
        data: { status: 'accepted', respondedAt: now },
      });
      await tx.rideOffer.updateMany({
        where: {
          rideId,
          id: { not: offerId },
          status: { in: ['pending', 'bid'] },
        },
        data: { status: 'closed', respondedAt: now },
      });
      await tx.ride.update({
        where: { id: rideId },
        data: {
          status: 'accepted',
          driverId,
          vehicleId: presence.vehicleId,
          acceptedAt: now,
          fare: amount,
        },
      });

      const busy = await tx.$executeRaw`
        UPDATE driver_presence SET "busy" = true, "updatedAt" = now()
        WHERE "userId" = ${driverId}::uuid AND "isOnline" AND NOT "busy"`;
      if (busy === 0) {
        throw new ConflictException(
          'That driver just became unavailable; pick another offer',
        );
      }
    });

    this.events.emit('ride.accepted', { rideId, driverId });
    return this.get(passengerId, rideId);
  }

  // Driver: "I am at the pickup". Must really be there (last known position).
  async arrived(driverId: string, rideId: string) {
    const ride = await this.ownRide(
      driverId,
      rideId,
      ['accepted'],
      'arrive at the pickup',
    );
    const position = await this.locations.getLocation(driverId);
    if (!position) {
      throw new ConflictException(
        'Your location is unknown. Keep the app open and try again',
      );
    }
    const away = Math.round(
      haversineMeters(position, { lat: ride.pickupLat, lng: ride.pickupLng }),
    );
    if (away > this.settings.arrivalRadiusMeters) {
      throw new ConflictException(
        `You are ${away} m from the pickup; get within ${this.settings.arrivalRadiusMeters} m first`,
      );
    }
    await this.transition(driverId, rideId, 'accepted', {
      status: 'arrived',
      arrivedAt: new Date(),
    });
    this.events.emit('ride.arrived', { rideId, driverId });
    return this.get(driverId, rideId);
  }

  // Driver: passenger is in the car. Distance tracking starts from here.
  async start(driverId: string, rideId: string) {
    await this.ownRide(driverId, rideId, ['arrived'], 'start the ride');
    const position = await this.locations.getLocation(driverId);
    await this.transition(driverId, rideId, 'arrived', {
      status: 'started',
      startedAt: new Date(),
      trackedMeters: 0,
      lastLat: position?.lat ?? null,
      lastLng: position?.lng ?? null,
    });
    this.events.emit('ride.started', { rideId, driverId });
    return this.get(driverId, rideId);
  }

  // Driver: drop-off reached. The fare is computed from what was actually driven.
  async complete(driverId: string, rideId: string) {
    const ride = await this.ownRide(
      driverId,
      rideId,
      ['started'],
      'complete the ride',
    );
    const now = new Date();
    const position = await this.locations.getLocation(driverId);
    const straightLine = position
      ? haversineMeters({ lat: ride.pickupLat, lng: ride.pickupLng }, position)
      : 0;
    const distanceMeters = billedDistanceMeters(
      ride.trackedMeters,
      straightLine,
      ride.estimatedDistanceMeters,
    );
    const durationSeconds = Math.max(
      1,
      Math.round((now.getTime() - (ride.startedAt ?? now).getTime()) / 1000),
    );
    // A negotiable ride's price was agreed when the passenger chose the offer
    // (ride.fare is already set); the metered calculation below is only for
    // the original fixed-price mode.
    let fare: number;
    if (ride.negotiable && ride.fare != null) {
      fare = ride.fare;
    } else {
      const rates =
        (ride.rates as FareRatesSnapshot | null) ??
        (await this.currentRates(ride.category, ride.tripType));
      fare = Math.min(
        calculateFare(rates, distanceMeters, durationSeconds),
        Math.round(ride.estimatedFare * this.settings.maxFareFactor),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const done = await tx.ride.updateMany({
        where: { id: rideId, driverId, status: 'started' },
        data: {
          status: 'completed',
          completedAt: now,
          distanceMeters,
          durationSeconds,
          fare,
        },
      });
      if (done.count === 0)
        throw new ConflictException('This ride is no longer in progress');
      await this.earnings.recordRideFare(tx, {
        driverId,
        rideId,
        amount: fare,
      });
      await tx.$executeRaw`
        UPDATE driver_presence SET "busy" = false, "updatedAt" = now()
        WHERE "userId" = ${driverId}::uuid`;
    });
    this.events.emit('ride.completed', { rideId, driverId, fare });
    return this.get(driverId, rideId);
  }

  // Either person on the ride can cancel until it has started. There is no
  // cancellation fee: rides are cash only, so there is nothing to charge.
  async cancel(userId: string, rideId: string, dto: CancelRideDto) {
    const ride = await this.prisma.ride.findFirst({
      where: {
        id: rideId,
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
      select: { passengerId: true, driverId: true, status: true },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.passengerId === userId)
      return this.cancelByPassenger(userId, rideId, dto);
    return this.cancelByDriver(userId, rideId, dto);
  }

  private async cancelByPassenger(
    passengerId: string,
    rideId: string,
    dto: CancelRideDto,
  ) {
    const now = new Date();
    let driverId: string | null = null;
    let from: RideStatus = 'requested';
    await this.prisma.$transaction(async (tx) => {
      const ride = await this.lockRide(tx, rideId);
      if (!['requested', 'accepted', 'arrived'].includes(ride.status)) {
        throw new ConflictException(
          ride.status === 'started'
            ? 'The ride has already started. Ask the driver to end it at your destination'
            : `A ride that is ${ride.status} cannot be cancelled`,
        );
      }
      from = ride.status;
      driverId = ride.driverId;
      await tx.ride.update({
        where: { id: rideId },
        data: {
          status: 'cancelled',
          cancelledBy: 'passenger',
          cancelledFromStatus: from,
          cancelReason: dto.reason,
          cancelledAt: now,
        },
      });
      await tx.rideOffer.updateMany({
        where: { rideId, status: 'pending' },
        data: { status: 'expired', respondedAt: now },
      });
      if (driverId) {
        await this.cancellations.record(tx, {
          rideId,
          userId: passengerId,
          role: 'passenger',
          fromStatus: from,
          reason: dto.reason,
        });
        // The driver is free again and can take another ride.
        await tx.$executeRaw`
          UPDATE driver_presence SET "busy" = false, "updatedAt" = now()
          WHERE "userId" = ${driverId}::uuid`;
      }
    });
    this.events.emit('ride.cancelled', {
      rideId,
      by: 'passenger',
      from,
      driverId,
    });
    return this.get(passengerId, rideId);
  }

  // A driver backing out does not cancel the passenger's trip: the ride goes
  // back to `requested` and is offered to other drivers, with a fresh deadline.
  private async cancelByDriver(
    driverId: string,
    rideId: string,
    dto: CancelRideDto,
  ) {
    const now = new Date();
    let from: RideStatus = 'accepted';
    let ride!: RideWithRelations;
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockRide(tx, rideId);
      if (
        locked.driverId !== driverId ||
        !['accepted', 'arrived'].includes(locked.status)
      ) {
        throw new ConflictException(
          locked.status === 'started'
            ? 'The ride has already started; complete it at the destination'
            : 'This ride can no longer be cancelled by you',
        );
      }
      from = locked.status;
      await tx.ride.update({
        where: { id: rideId },
        data: {
          status: 'requested',
          driverId: null,
          vehicleId: null,
          acceptedAt: null,
          arrivedAt: null,
          searchStep: 0,
          searchRadiusMeters: this.settings.radiiMeters[0],
          nextExpandAt: new Date(
            now.getTime() + this.settings.offerTtlSeconds * 1000,
          ),
          expiresAt: new Date(
            now.getTime() + this.settings.requestTtlSeconds * 1000,
          ),
        },
      });
      // Drivers who missed the ride the first time are eligible again; the one
      // who backed out stays marked so they are not offered it a second time.
      await this.cancellations.record(tx, {
        rideId,
        userId: driverId,
        role: 'driver',
        fromStatus: from,
        reason: dto.reason,
      });
      await tx.rideOffer.deleteMany({ where: { rideId, NOT: { driverId } } });
      await tx.rideOffer.updateMany({
        where: { rideId, driverId },
        data: { status: 'declined', respondedAt: now },
      });
      await tx.$executeRaw`
        UPDATE driver_presence SET "busy" = false, "updatedAt" = now()
        WHERE "userId" = ${driverId}::uuid`;
    });
    ride = await this.prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
      include: rideInclude,
    });
    await this.matching.offerRide(ride);
    this.events.emit('ride.driver_cancelled', {
      rideId,
      driverId,
      from,
      reason: dto.reason ?? null,
    });
    return { message: 'Ride released. It is being offered to other drivers' };
  }

  // Loads a ride the driver is assigned to and checks it is in an allowed state.
  private async ownRide(
    driverId: string,
    rideId: string,
    allowed: RideStatus[],
    action: string,
  ) {
    const ride = await this.prisma.ride.findFirst({
      where: { id: rideId, driverId },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (!allowed.includes(ride.status)) {
      throw new ConflictException(
        `You cannot ${action} while the ride is ${ride.status}`,
      );
    }
    return ride;
  }

  // Moves a ride from one status to the next only if nobody changed it meanwhile.
  private async transition(
    driverId: string,
    rideId: string,
    from: RideStatus,
    data: Record<string, unknown>,
  ) {
    const result = await this.prisma.ride.updateMany({
      where: { id: rideId, driverId, status: from },
      data,
    });
    if (result.count === 0) {
      throw new ConflictException(
        'The ride changed while you were updating it. Refresh and retry',
      );
    }
  }

  private async lockRide(
    tx: { $queryRaw: PrismaService['$queryRaw'] },
    rideId: string,
  ): Promise<{
    category: string;
    status: RideStatus;
    driverId: string | null;
    passengerId: string;
    negotiable: boolean;
    offeredFare: number | null;
  }> {
    const rows = await tx.$queryRaw<
      {
        category: string;
        status: RideStatus;
        driverId: string | null;
        passengerId: string;
        negotiable: boolean;
        offeredFare: number | null;
      }[]
    >`SELECT "category", "status"::text AS "status", "driverId", "passengerId",
             "negotiable", "offeredFare"
      FROM rides WHERE "id" = ${rideId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException('Ride not found');
    return rows[0];
  }

  private async currentRates(
    category: string,
    tripType: TripType,
  ): Promise<FareRatesSnapshot> {
    return this.prisma.fareConfig.findUniqueOrThrow({
      where: { category_tripType: { category, tripType } },
    });
  }

  // Adds the driver's live position and pickup ETA/distance while they come to the passenger.
  private async view(ride: RideWithRelations, viewerId: string) {
    const myRating =
      ride.status === 'completed'
        ? await this.ratings.mine(ride.id, viewerId)
        : null;
    if (!ride.driverId || !DRIVER_ACTIVE.includes(ride.status)) {
      return presentRide(ride, { myRating });
    }
    const driverLocation = await this.locations.getLocation(ride.driverId);
    let driverEtaSeconds: number | null = null;
    let driverDistanceToPickupMeters: number | null = null;
    if (driverLocation && ride.status === 'accepted') {
      const toPickup = await this.routing.route(driverLocation, {
        lat: ride.pickupLat,
        lng: ride.pickupLng,
      });
      driverEtaSeconds = toPickup.durationSeconds;
      driverDistanceToPickupMeters = toPickup.distanceMeters;
    }
    return presentRide(ride, {
      driverLocation,
      driverEtaSeconds,
      driverDistanceToPickupMeters,
      driverAvatarUrl: await this.avatarUrl(ride.driver?.avatarKey ?? null),
      myRating,
    });
  }

  // Reads must keep working when storage is briefly unreachable - a broken
  // photo is better than a broken ride screen.
  private async avatarUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.createSignedUrl(key, 60 * 60);
    } catch {
      return null;
    }
  }
}
