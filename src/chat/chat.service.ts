import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { RideStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Sending is only allowed once a driver is assigned and the ride has not
// ended yet - the same window the ride view shows each side the other's
// phone number in (see PHONE_VISIBLE in ride.presenter.ts). Reading the
// history has no time limit: like the rest of a ride's record, a finished
// conversation stays visible to the two people who had it.
const MESSAGING_ALLOWED: RideStatus[] = ['accepted', 'arrived', 'started'];

export interface ChatMessageView {
  id: string;
  rideId: string;
  senderId: string;
  senderRole: 'passenger' | 'driver';
  body: string;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {}

  async send(
    userId: string,
    rideId: string,
    body: string,
  ): Promise<ChatMessageView> {
    const ride = await this.rideFor(userId, rideId);
    // Also a booking for later once its driver is confirmed.
    const confirmedBooking = ride.status === 'scheduled' && ride.driverId;
    if (!MESSAGING_ALLOWED.includes(ride.status) && !confirmedBooking) {
      throw new ConflictException(
        'Messaging is only available while a driver is on the way or on the trip',
      );
    }

    const message = await this.prisma.rideMessage.create({
      data: { rideId, senderId: userId, body },
    });
    const view = this.present(message, ride);

    const recipientId =
      userId === ride.passengerId ? ride.driverId : ride.passengerId;
    if (recipientId) {
      this.events.emit('ride.message', { ...view, recipientId });
    }
    return view;
  }

  async list(
    userId: string,
    rideId: string,
    opts: { limit: number; cursor?: string },
  ) {
    const ride = await this.rideFor(userId, rideId);
    const before = decodeCursor(opts.cursor);

    const rows = await this.prisma.rideMessage.findMany({
      where: {
        rideId,
        ...(before && {
          OR: [
            { createdAt: { lt: before.at } },
            { createdAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });

    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      // Oldest first, the order a chat thread reads in.
      items: page.map((m) => this.present(m, ride)).reverse(),
      nextCursor:
        rows.length > opts.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  // The ride, only if the caller is its passenger or its assigned driver.
  private async rideFor(userId: string, rideId: string) {
    const ride = await this.prisma.ride.findFirst({
      where: {
        id: rideId,
        OR: [{ passengerId: userId }, { driverId: userId }],
      },
      select: { passengerId: true, driverId: true, status: true },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  private present(
    message: {
      id: string;
      rideId: string;
      senderId: string;
      body: string;
      createdAt: Date;
    },
    ride: { passengerId: string },
  ): ChatMessageView {
    return {
      id: message.id,
      rideId: message.rideId,
      senderId: message.senderId,
      senderRole:
        message.senderId === ride.passengerId ? 'passenger' : 'driver',
      body: message.body,
      createdAt: message.createdAt,
    };
  }
}
