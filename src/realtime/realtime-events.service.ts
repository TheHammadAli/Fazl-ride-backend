import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { DomainEvents } from '../events/domain-events.service.js';
import { RidesService } from '../rides/rides.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { RealtimeGateway } from './realtime.gateway.js';

// A driver position is sent to the passenger at most this often.
const LOCATION_FANOUT_GAP_MS = 1_500;

// Turns what the rest of the system announces (domain events) into what each
// app should be told, and sends it to exactly the people concerned.
@Injectable()
export class RealtimeEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventsService.name);
  private subscription?: Subscription;
  private readonly lastLocationSent = new Map<string, number>();

  constructor(
    private readonly events: DomainEvents,
    private readonly gateway: RealtimeGateway,
    private readonly rides: RidesService,
    private readonly routing: RoutingProvider,
  ) {}

  onModuleInit() {
    this.subscription = this.events.on().subscribe((event) => {
      void this.handle(event.type, event.payload as any).catch((error) =>
        this.logger.warn(`Could not deliver ${event.type}: ${String(error)}`),
      );
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private async handle(type: string, p: any) {
    switch (type) {
      case 'ride.offer.created':
        return this.sendOffer(p.driverId, p.rideId);

      case 'ride.accepted':
        await this.closeOffers(p.rideId, 'taken', p.driverId);
        return this.sendRideUpdate(p.rideId);

      case 'ride.arrived':
      case 'ride.started':
      case 'ride.completed':
        return this.sendRideUpdate(p.rideId);

      case 'ride.cancelled':
        await this.closeOffers(p.rideId, 'cancelled');
        return this.sendRideUpdate(p.rideId);

      case 'ride.expired':
        await this.closeOffers(p.rideId, 'expired');
        return this.sendRideUpdate(p.rideId);

      case 'ride.driver_cancelled':
        // The trip goes back to searching: the passenger sees it as a plain update.
        return this.sendRideUpdate(p.rideId, { skipUserId: p.driverId });

      case 'driver.location':
        return this.sendDriverLocation(p);

      case 'driver.offline':
        // The driver was put offline for being idle; the app should show it and offer "Go Online".
        return this.gateway.emitToUser(p.userId, 'driver:offline', {
          reason: p.reason,
          lastSeenAt: p.lastSeenAt,
        });

      case 'user.blocked':
        return this.gateway.disconnectUser(
          p.userId,
          'Your account has been blocked',
        );
      case 'user.deleted':
        return this.gateway.disconnectUser(
          p.userId,
          'Your account has been deleted',
        );
    }
  }

  private async sendOffer(driverId: string, rideId: string) {
    const offer = await this.rides.offerFor(driverId, rideId);
    if (offer) this.gateway.emitToUser(driverId, 'ride:offer', offer);
  }

  // Tells the drivers who were asked but did not get the ride that the offer is gone.
  private async closeOffers(
    rideId: string,
    reason: string,
    exceptDriverId?: string,
  ) {
    const drivers = await this.rides.offeredDriverIds(rideId, exceptDriverId);
    for (const driverId of drivers) {
      this.gateway.emitToUser(driverId, 'ride:offer_closed', {
        rideId,
        reason,
      });
    }
  }

  // Each person gets the same view they would get from GET /rides/:id.
  private async sendRideUpdate(
    rideId: string,
    opts: { skipUserId?: string } = {},
  ) {
    const parties = await this.rides.partiesOf(rideId);
    if (!parties) return;
    for (const userId of parties) {
      if (userId === opts.skipUserId) continue;
      const view = await this.rides.get(userId, rideId).catch(() => null);
      if (view) this.gateway.emitToUser(userId, 'ride:update', view);
    }
  }

  private async sendDriverLocation(p: {
    userId: string;
    lat: number;
    lng: number;
    busy: boolean;
  }) {
    if (!p.busy) return;
    const now = Date.now();
    if (
      now - (this.lastLocationSent.get(p.userId) ?? 0) <
      LOCATION_FANOUT_GAP_MS
    )
      return;

    const trip = await this.rides.activeTripOf(p.userId);
    if (!trip) return;
    this.lastLocationSent.set(p.userId, now);

    // While the driver is coming to the pickup, include how far and how long is left.
    const toPickup =
      trip.status === 'accepted'
        ? await this.routing.route(
            { lat: p.lat, lng: p.lng },
            { lat: trip.pickupLat, lng: trip.pickupLng },
          )
        : null;
    this.gateway.emitToUser(trip.passengerId, 'driver:location', {
      rideId: trip.rideId,
      status: trip.status,
      lat: p.lat,
      lng: p.lng,
      etaSeconds: toPickup?.durationSeconds ?? null,
      distanceToPickupMeters: toPickup?.distanceMeters ?? null,
    });
  }
}
