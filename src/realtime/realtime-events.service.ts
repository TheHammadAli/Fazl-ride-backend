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
import { WalletService } from '../wallet/wallet.service.js';
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
    private readonly wallet: WalletService,
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

      case 'ride.bid.received':
        return this.sendBidToPassenger(p.rideId, p.driverId);

      case 'ride.offer.updated':
        return this.refreshPendingOffers(p.rideId);

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

      case 'ride.reservation_confirmed':
      case 'ride.reservation_released':
        // A booking for later got (or lost) its confirmed driver.
        return this.sendRideUpdate(p.rideId);

      case 'ride.dispatched':
        // A booking for later started looking for a driver.
        return this.sendRideUpdate(p.rideId);

      case 'ride.driver_cancelled':
        // The trip goes back to searching: the passenger sees it as a plain update.
        return this.sendRideUpdate(p.rideId, { skipUserId: p.driverId });

      case 'ride.message':
        return this.gateway.emitToUser(p.recipientId, 'ride:message', {
          id: p.id,
          rideId: p.rideId,
          senderId: p.senderId,
          senderRole: p.senderRole,
          body: p.body,
          createdAt: p.createdAt,
        });

      case 'driver.location':
        return this.sendDriverLocation(p);

      case 'driver.offline':
        // The driver was put offline for being idle; the app should show it and offer "Go Online".
        return this.gateway.emitToUser(p.userId, 'driver:offline', {
          reason: p.reason,
          lastSeenAt: p.lastSeenAt,
        });

      case 'driver.destination_reached':
        // Destination mode switched itself off on arrival.
        return this.gateway.emitToUser(p.userId, 'driver:destination_reached', {
          address: p.address,
        });

      case 'wallet.changed':
        // A balance moved (ride paid, top-up approved, change received...).
        return this.gateway.emitToUser(p.userId, 'wallet:update', {
          balance: await this.wallet.balanceOf(p.userId),
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

  // The passenger changed the price (or auto-accept) while still waiting;
  // drivers who have not answered yet get a fresh copy of the offer.
  private async refreshPendingOffers(rideId: string) {
    const driverIds = await this.rides.pendingDriverIds(rideId);
    for (const driverId of driverIds) await this.sendOffer(driverId, rideId);
  }

  // A driver answered a negotiable ride; the passenger's offers list updates live.
  private async sendBidToPassenger(rideId: string, driverId: string) {
    const parties = await this.rides.partiesOf(rideId);
    const passengerId = parties?.[0];
    if (!passengerId) return;
    const bid = await this.rides.bidFor(rideId, driverId);
    if (bid)
      this.gateway.emitToUser(passengerId, 'ride:bid', { rideId, ...bid });
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
