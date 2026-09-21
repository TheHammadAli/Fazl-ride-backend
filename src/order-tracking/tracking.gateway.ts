import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { DomainEvents } from '../events/domain-events.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { OrdersService } from './orders.service.js';
import { TrackingTokenService } from './tracking-token.service.js';

const LOCATION_FANOUT_GAP_MS = 1_500;
const MAX_TIMER_MS = 2 ** 31 - 1;
const orderRoom = (orderId: string) => `order:${orderId}`;

interface SocketData {
  orderId?: string;
  expiryTimer?: NodeJS.Timeout;
}

// Live tracking for the customer's app. It has its own namespace because these
// clients are not users: they hold a tracking token for ONE order and nothing else.
@WebSocketGateway({ namespace: '/tracking' })
export class TrackingGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(TrackingGateway.name);
  private subscription?: Subscription;
  private readonly lastLocationSent = new Map<string, number>();
  @WebSocketServer() server: Server;

  constructor(
    private readonly tokens: TrackingTokenService,
    private readonly orders: OrdersService,
    private readonly events: DomainEvents,
    private readonly routing: RoutingProvider,
  ) {}

  onModuleInit() {
    this.subscription = this.events.on().subscribe((event) => {
      void this.onEvent(event.type, event.payload as any).catch((error) =>
        this.logger.warn(`Could not deliver ${event.type}: ${String(error)}`),
      );
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  async handleConnection(socket: Socket) {
    const raw = socket.handshake.auth?.token;
    const found =
      typeof raw === 'string' && raw ? await this.tokens.resolve(raw) : null;
    if (!found) {
      socket.emit('auth:error', {
        message: 'Invalid or expired tracking link',
      });
      socket.disconnect(true);
      return;
    }
    const data = socket.data as SocketData;
    data.orderId = found.orderId;
    await socket.join(orderRoom(found.orderId));

    // A socket must not outlive the link that opened it.
    const wait = Math.min(
      Math.max(found.expiresAt.getTime() - Date.now(), 0),
      MAX_TIMER_MS,
    );
    data.expiryTimer = setTimeout(() => {
      socket.emit('auth:expired', {
        message: 'This tracking link has expired',
      });
      socket.disconnect(true);
    }, wait);
    data.expiryTimer.unref();

    // Start with the full picture, then only changes follow.
    socket.emit('order:update', await this.orders.viewById(found.orderId));
  }

  handleDisconnect(socket: Socket) {
    clearTimeout((socket.data as SocketData).expiryTimer);
  }

  private async onEvent(type: string, p: any) {
    switch (type) {
      case 'order.created':
      case 'order.updated':
        this.server
          ?.to(orderRoom(p.orderId))
          .emit('order:update', await this.orders.viewById(p.orderId));
        return;

      case 'order.location':
        return this.sendLocation(p);

      case 'order.tokens_revoked': {
        const sockets = await this.server
          .in(orderRoom(p.orderId))
          .fetchSockets();
        for (const s of sockets) {
          s.emit('auth:revoked', {
            message: 'This tracking link was cancelled',
          });
          s.disconnect(true);
        }
        return;
      }
    }
  }

  private async sendLocation(p: {
    orderId: string;
    lat: number;
    lng: number;
    heading: number | null;
    etaSeconds: number | null;
    deliveryLat: number;
    deliveryLng: number;
  }) {
    const now = Date.now();
    if (
      now - (this.lastLocationSent.get(p.orderId) ?? 0) <
      LOCATION_FANOUT_GAP_MS
    )
      return;
    this.lastLocationSent.set(p.orderId, now);
    const route = await this.routing.route(
      { lat: p.lat, lng: p.lng },
      { lat: p.deliveryLat, lng: p.deliveryLng },
    );
    this.server?.to(orderRoom(p.orderId)).emit('order:location', {
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      etaSeconds: p.etaSeconds ?? route.durationSeconds,
      distanceRemainingMeters: route.distanceMeters,
    });
  }
}
