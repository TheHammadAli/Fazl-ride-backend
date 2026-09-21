import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { haversineMeters } from '../common/geo.js';
import { MIN_LEG_METERS, tripLeg } from './trip-distance.js';

interface DriverLocationEvent {
  userId: string;
  lat: number;
  lng: number;
  busy: boolean;
}

// Adds up the distance a driver covers while a ride is in progress. It listens
// to `driver.location` events, so presence and rides stay independent modules.
@Injectable()
export class TripTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripTrackerService.name);
  private subscription?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit() {
    this.subscription = this.events
      .on<DriverLocationEvent>('driver.location')
      .subscribe((e) => {
        // Only drivers who are busy can be on a ride, so idle drivers cost nothing.
        if (e.payload.busy)
          void this.track(e.payload).catch((err) =>
            this.logger.warn(String(err)),
          );
      });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  async track({ userId, lat, lng }: DriverLocationEvent) {
    const ride = await this.prisma.ride.findFirst({
      where: { driverId: userId, status: 'started' },
      select: { id: true, lastLat: true, lastLng: true },
    });
    if (!ride) return;
    const previous =
      ride.lastLat != null && ride.lastLng != null
        ? { lat: ride.lastLat, lng: ride.lastLng }
        : null;
    const next = { lat, lng };
    const moved = previous
      ? haversineMeters(previous, next) >= MIN_LEG_METERS
      : true;
    await this.prisma.ride.update({
      where: { id: ride.id },
      data: {
        trackedMeters: { increment: previous ? tripLeg(previous, next) : 0 },
        // Not moved (GPS jitter): keep the old fix so slow drift still adds up.
        // Moved but too far to be believable: count nothing but restart from
        // here, so one glitch or a long signal gap cannot freeze the tracking.
        ...(moved ? { lastLat: lat, lastLng: lng } : {}),
      },
    });
  }
}
