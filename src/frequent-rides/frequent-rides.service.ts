import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TZ_OFFSET_MINUTES } from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BookFrequentRideDto,
  CreateFrequentRideRouteDto,
  ReviewFrequentRideApplicationDto,
  SearchFrequentRidesDto,
  UpdateFrequentRideRouteDto,
} from './dto/frequent-rides.dto.js';

const ROUTE_INCLUDE = {
  stops: { orderBy: { position: 'asc' as const } },
  vehicle: {
    select: {
      id: true,
      make: true,
      model: true,
      color: true,
      category: true,
    },
  },
  driver: {
    select: { id: true, name: true, ratingSum: true, ratingCount: true },
  },
};

const rad = (degrees: number) => (degrees * Math.PI) / 180;
function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = rad(b.lat - a.lat),
    dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parseDate(text: string, tzOffsetMinutes: number) {
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    throw new BadRequestException('Choose a valid travel date');
  }
  const today = localDateKey(new Date(), tzOffsetMinutes);
  if (text < today) {
    throw new BadRequestException('Travel date cannot be in the past');
  }
  return date;
}

function localDateKey(now: Date, tzOffsetMinutes: number) {
  const localNow = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, '0')}-${String(localNow.getUTCDate()).padStart(2, '0')}`;
}

function localTimeText(now: Date, tzOffsetMinutes: number) {
  const localNow = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return `${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}`;
}

const weekDay = (date: Date) => date.getUTCDay() || 7;

@Injectable()
export class FrequentRidesService {
  private readonly tzOffsetMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.tzOffsetMinutes = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  async application(driverId: string) {
    const row = await this.prisma.frequentRideApplication.findUnique({
      where: { driverId },
    });
    return { application: row };
  }

  async apply(driverId: string) {
    await this.assertApprovedDriver(driverId);
    const existing = await this.prisma.frequentRideApplication.findUnique({
      where: { driverId },
    });
    if (existing?.status === 'approved' || existing?.status === 'pending') {
      throw new ConflictException(
        'Your Frequent Ride application is already under review or approved',
      );
    }
    const row = existing
      ? await this.prisma.frequentRideApplication.update({
          where: { driverId },
          data: {
            status: 'pending',
            reason: null,
            reviewedBy: null,
            reviewedAt: null,
          },
        })
      : await this.prisma.frequentRideApplication.create({
          data: { driverId, status: 'pending' },
        });
    return { application: row };
  }

  async pendingApplications() {
    const items = await this.prisma.frequentRideApplication.findMany({
      where: { status: 'pending' },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            driverProfile: {
              select: { status: true, cnic: true, licenseNumber: true },
            },
            vehicles: {
              where: { status: 'approved' },
              select: { id: true, make: true, model: true, plateNumber: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { items };
  }

  async reviewApplication(
    adminId: string,
    id: string,
    dto: ReviewFrequentRideApplicationDto,
  ) {
    const app = await this.prisma.frequentRideApplication.findUnique({
      where: { id },
    });
    if (!app)
      throw new NotFoundException('Frequent ride application not found');
    if (app.status !== 'pending')
      throw new ConflictException('This application was already reviewed');
    const updated = await this.prisma.frequentRideApplication.update({
      where: { id },
      data: {
        status: dto.status,
        reason:
          dto.status === 'rejected'
            ? dto.reason?.trim() || 'Application rejected'
            : null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });
    return { application: updated };
  }

  async myRoutes(driverId: string) {
    const items = await this.prisma.frequentRideRoute.findMany({
      where: { driverId },
      include: ROUTE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async createRoute(driverId: string, dto: CreateFrequentRideRouteDto) {
    await this.assertApprovedDriver(driverId);
    const application = await this.prisma.frequentRideApplication.findUnique({
      where: { driverId },
    });
    if (application?.status !== 'approved') {
      throw new ForbiddenException(
        'Apply for Frequent Rides and wait for admin approval first',
      );
    }
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: dto.vehicleId,
        status: 'approved',
        driverProfile: { userId: driverId },
      },
      select: { id: true },
    });
    if (!vehicle)
      throw new BadRequestException('Choose one of your approved vehicles');
    const route = await this.prisma.frequentRideRoute.create({
      data: {
        driverId,
        vehicleId: vehicle.id,
        title: dto.title?.trim() || null,
        departureTime: dto.departureTime,
        days: [...dto.days].sort((a, b) => a - b),
        seats: dto.seats,
        fare: dto.fare,
        stops: {
          create: dto.stops.map((stop, position) => ({ ...stop, position })),
        },
      },
      include: ROUTE_INCLUDE,
    });
    return { route };
  }

  async updateRoute(
    driverId: string,
    id: string,
    dto: UpdateFrequentRideRouteDto,
  ) {
    await this.ownRoute(driverId, id);
    const route = await this.prisma.frequentRideRoute.update({
      where: { id },
      data: { active: dto.active },
      include: ROUTE_INCLUDE,
    });
    return { route };
  }

  async search(dto: SearchFrequentRidesDto) {
    const date = parseDate(dto.date, this.tzOffsetMinutes);
    const day = weekDay(date);
    const routes = await this.prisma.frequentRideRoute.findMany({
      where: {
        active: true,
        days: { has: day },
        driver: {
          driverProfile: { is: { status: 'approved' } },
          frequentRideApplication: { is: { status: 'approved' } },
        },
        vehicle: { status: 'approved' },
      },
      include: {
        ...ROUTE_INCLUDE,
        bookings: { where: { rideDate: date, status: 'confirmed' } },
      },
      orderBy: { departureTime: 'asc' },
    });
    const pickup = { lat: dto.pickupLat, lng: dto.pickupLng };
    const dropoff = { lat: dto.dropoffLat, lng: dto.dropoffLng };
    const today = localDateKey(new Date(), this.tzOffsetMinutes);
    const currentTime = localTimeText(new Date(), this.tzOffsetMinutes);
    const matches: Array<Record<string, unknown>> = [];
    for (const route of routes) {
      if (dto.date === today && route.departureTime <= currentTime) continue;
      let nearest: { from: number; to: number; score: number } | null = null;
      for (let from = 0; from < route.stops.length - 1; from++) {
        const pickupDistance = distanceKm(pickup, route.stops[from]);
        if (pickupDistance > 3) continue;
        for (let to = from + 1; to < route.stops.length; to++) {
          const dropDistance = distanceKm(dropoff, route.stops[to]);
          const score = pickupDistance + dropDistance;
          if (dropDistance <= 3 && (!nearest || score < nearest.score))
            nearest = { from, to, score };
        }
      }
      if (!nearest) continue;
      const availableSeats = this.availableSeats(
        route.seats,
        route.bookings,
        nearest.from,
        nearest.to,
      );
      if (availableSeats < 1) continue;
      matches.push({
        ...route,
        fromStop: route.stops[nearest.from],
        toStop: route.stops[nearest.to],
        fromPosition: nearest.from,
        toPosition: nearest.to,
        pickupDistanceKm: distanceKm(pickup, route.stops[nearest.from]),
        dropoffDistanceKm: distanceKm(dropoff, route.stops[nearest.to]),
        fare: this.segmentFare(
          route.fare,
          route.stops,
          nearest.from,
          nearest.to,
        ),
        availableSeats,
      });
    }
    return { items: matches };
  }

  async book(passengerId: string, routeId: string, dto: BookFrequentRideDto) {
    const date = parseDate(dto.date, this.tzOffsetMinutes);
    const seats = dto.seats ?? 1;
    const booking = await this.prisma.$transaction(async (tx) => {
      // Serialize seat allocation for a specific route and date.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${routeId}), hashtext(${dto.date}))`;
      const route = await tx.frequentRideRoute.findFirst({
        where: {
          id: routeId,
          active: true,
          driver: {
            driverProfile: { is: { status: 'approved' } },
            frequentRideApplication: { is: { status: 'approved' } },
          },
          vehicle: { status: 'approved' },
        },
        include: {
          stops: { orderBy: { position: 'asc' } },
          bookings: { where: { rideDate: date, status: 'confirmed' } },
        },
      });
      if (!route) throw new NotFoundException('Frequent ride route not found');
      if (!route.days.includes(weekDay(date)))
        throw new BadRequestException('This route does not run on that day');
      if (
        dto.date === localDateKey(new Date(), this.tzOffsetMinutes) &&
        route.departureTime <= localTimeText(new Date(), this.tzOffsetMinutes)
      ) {
        throw new ConflictException('This frequent ride has already departed');
      }
      if (
        dto.fromPosition < 0 ||
        dto.toPosition >= route.stops.length ||
        dto.fromPosition >= dto.toPosition
      ) {
        throw new BadRequestException(
          'Choose a valid pickup and drop-off on the route',
        );
      }
      if (route.driverId === passengerId)
        throw new ConflictException('You cannot book your own route');
      const ownBooking = route.bookings.some(
        (b) =>
          b.passengerId === passengerId &&
          b.fromPosition < dto.toPosition &&
          b.toPosition > dto.fromPosition,
      );
      if (ownBooking)
        throw new ConflictException(
          'You already have a booking for this part of the route',
        );
      if (
        this.availableSeats(
          route.seats,
          route.bookings,
          dto.fromPosition,
          dto.toPosition,
        ) < seats
      ) {
        throw new ConflictException(
          'There are not enough seats for this part of the route',
        );
      }
      const fare =
        this.segmentFare(
          route.fare,
          route.stops,
          dto.fromPosition,
          dto.toPosition,
        ) * seats;
      return tx.frequentRideBooking.create({
        data: {
          routeId,
          passengerId,
          rideDate: date,
          fromPosition: dto.fromPosition,
          toPosition: dto.toPosition,
          seats,
          fare,
        },
        include: {
          route: { include: ROUTE_INCLUDE },
          passenger: { select: { id: true, name: true } },
        },
      });
    });
    return { booking };
  }

  async bookings(userId: string, side: 'driver' | 'passenger' = 'passenger') {
    const items = await this.prisma.frequentRideBooking.findMany({
      where:
        side === 'driver'
          ? { route: { driverId: userId } }
          : { passengerId: userId },
      include: {
        route: { include: ROUTE_INCLUDE },
        passenger: { select: { id: true, name: true, phone: true } },
      },
      orderBy: [{ rideDate: 'asc' }, { createdAt: 'desc' }],
    });
    return { items };
  }

  async cancelBooking(userId: string, id: string) {
    const booking = await this.prisma.frequentRideBooking.findFirst({
      where: {
        id,
        status: 'confirmed',
        OR: [{ passengerId: userId }, { route: { driverId: userId } }],
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (
      booking.rideDate.toISOString().slice(0, 10) <
      localDateKey(new Date(), this.tzOffsetMinutes)
    ) {
      throw new ConflictException('A past booking cannot be cancelled');
    }
    const updated = await this.prisma.frequentRideBooking.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return { booking: updated };
  }

  private async assertApprovedDriver(driverId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { status: true },
    });
    if (profile?.status !== 'approved')
      throw new ForbiddenException(
        'Your driver account must be approved first',
      );
  }

  private async ownRoute(driverId: string, id: string) {
    const route = await this.prisma.frequentRideRoute.findFirst({
      where: { id, driverId },
    });
    if (!route) throw new NotFoundException('Frequent ride route not found');
    return route;
  }

  private availableSeats(
    capacity: number,
    bookings: Array<{
      fromPosition: number;
      toPosition: number;
      seats: number;
    }>,
    from: number,
    to: number,
  ) {
    let available = capacity;
    for (let segment = from; segment < to; segment++) {
      const occupied = bookings
        .filter((b) => b.fromPosition <= segment && b.toPosition > segment)
        .reduce((sum, b) => sum + b.seats, 0);
      available = Math.min(available, capacity - occupied);
    }
    return Math.max(0, available);
  }

  private segmentFare(
    fullFare: number,
    stops: Array<{ lat: number; lng: number }>,
    from: number,
    to: number,
  ) {
    let total = 0,
      segment = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const distance = distanceKm(stops[i], stops[i + 1]);
      total += distance;
      if (i >= from && i < to) segment += distance;
    }
    return Math.max(
      1,
      Math.round(fullFare * (total > 0 ? segment / total : 0)),
    );
  }
}
