import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { LocationUpdateDto } from '../presence/dto/presence.dto.js';
import { PresenceService } from '../presence/presence.service.js';
import {
  RealtimeAuthService,
  tokenFromHandshake,
} from './realtime-auth.service.js';

// At most one location update per socket in this many milliseconds.
const MIN_LOCATION_GAP_MS = 500;
// setTimeout cannot wait longer than this.
const MAX_TIMER_MS = 2 ** 31 - 1;

interface SocketData {
  user: AuthUser;
  lastLocationAt?: number;
  expiryTimer?: NodeJS.Timeout;
}

export const userRoom = (userId: string) => `user:${userId}`;

// One connection per app session. Everything a person may see is sent to their
// private room `user:<id>`, so a client never has to say what it wants to hear.
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = tokenFromHandshake(socket.handshake);
    const result = token ? await this.auth.authenticate(token) : null;
    if (!result) {
      socket.emit('auth:error', { message: 'Invalid or expired token' });
      socket.disconnect(true);
      return;
    }

    const data = socket.data as SocketData;
    data.user = result.user;
    await socket.join(userRoom(result.user.id));

    // Access tokens are short-lived. When this one runs out the app must refresh
    // it and reconnect; a socket must not outlive the login that opened it.
    const wait = Math.min(
      Math.max(result.expiresAtMs - Date.now(), 0),
      MAX_TIMER_MS,
    );
    data.expiryTimer = setTimeout(() => {
      socket.emit('auth:expired', {
        message: 'Token expired. Refresh it and reconnect',
      });
      socket.disconnect(true);
    }, wait);
    data.expiryTimer.unref();

    socket.emit('connected', {
      userId: result.user.id,
      serverTime: new Date().toISOString(),
    });
  }

  handleDisconnect(socket: Socket) {
    clearTimeout((socket.data as SocketData).expiryTimer);
  }

  // The Driver app streams its position over the socket instead of many HTTP calls.
  @SubscribeMessage('driver:location')
  async onDriverLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ) {
    const data = socket.data as SocketData;
    if (!data.user) return { ok: false, error: 'unauthenticated' };

    const now = Date.now();
    if (
      data.lastLocationAt &&
      now - data.lastLocationAt < MIN_LOCATION_GAP_MS
    ) {
      return { ok: false, error: 'too_fast' };
    }
    data.lastLocationAt = now;

    const fresh = await this.auth.loadUser(data.user.id);
    if (!fresh) {
      socket.disconnect(true);
      return { ok: false, error: 'unauthenticated' };
    }
    if (!fresh.roles.includes('driver'))
      return { ok: false, error: 'forbidden' };

    const dto = plainToInstance(LocationUpdateDto, body);
    const problems = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (problems.length) return { ok: false, error: 'invalid_payload' };

    try {
      await this.presence.updateLocation(fresh.id, dto);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? 'failed' };
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  // Used when someone is blocked or deletes their account.
  async disconnectUser(userId: string, reason: string) {
    if (!this.server) return;
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    for (const socket of sockets) {
      socket.emit('auth:revoked', { message: reason });
      socket.disconnect(true);
    }
    if (sockets.length)
      this.logger.log(`Disconnected ${sockets.length} socket(s) of ${userId}`);
  }
}
