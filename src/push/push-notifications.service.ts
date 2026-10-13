import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TZ_OFFSET_MINUTES } from '../common/time.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DevicesService } from './devices.service.js';
import type { PushMessage } from './push.provider.js';

// "House 12, Street 4, F-7, Islamabad" -> "House 12".
const short = (address: string) => address.split(',')[0].trim();
const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

// "today 8:30 PM", "tomorrow 8:30 AM", "Fri 17 Oct, 8:30 AM" in business
// time (Pakistan by default).
export function bookingTime(
  at: Date,
  tzOffsetMinutes: number,
  now = new Date(),
): string {
  const shift = (d: Date) => new Date(d.getTime() + tzOffsetMinutes * 60_000);
  const local = shift(at);
  const today = shift(now);
  const dayIndex = (d: Date) =>
    Math.floor(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) /
        86_400_000,
    );
  const time = local.toLocaleTimeString('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  });
  const days = dayIndex(local) - dayIndex(today);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  const date = local.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${date}, ${time}`;
}

// Turns what happened (domain events) into push notifications for people
// whose app may be closed. The socket still updates an open app; Android
// shows nothing for a push while the app is in front, so there is no double.
@Injectable()
export class PushNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushNotificationsService.name);
  private subscription?: Subscription;

  private readonly tzOffset: number;

  constructor(
    private readonly events: DomainEvents,
    private readonly devices: DevicesService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  onModuleInit() {
    this.subscription = this.events.on().subscribe((event) => {
      void this.handle(event.type, event.payload as any).catch((error) =>
        this.logger.warn(`Push for ${event.type} failed: ${String(error)}`),
      );
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private async handle(type: string, p: any) {
    if (
      type.startsWith('booking.') ||
      type.startsWith('ride.reservation_') ||
      type === 'ride.expired'
    ) {
      // A booking for later that expired is told apart inside.
      if (await this.booking(type, p)) return;
    }
    switch (type) {
      case 'ride.offer.created':
        return this.newRequest(p.rideId, p.driverId, p.expiresAt);

      case 'ride.bid.received':
        return this.newBid(p.rideId, p.driverId);

      case 'ride.accepted':
        return this.toPassenger(p.rideId, async (ride) => ({
          title: 'Driver found',
          body: `${ride.driverName ?? 'Your driver'} is on the way${ride.vehicle ? ` in a ${ride.vehicle}` : ''}.`,
        }));

      case 'ride.arrived':
        return this.toPassenger(p.rideId, async (ride) => ({
          title: 'Your driver has arrived',
          body: `${ride.driverName ?? 'Your driver'} is waiting at the pickup.`,
        }));

      case 'ride.completed':
        return this.toPassenger(p.rideId, async () => ({
          title: 'Trip completed',
          body: `Total ${rs(p.fare)}. Tap to rate your driver.`,
        }));

      case 'ride.driver_cancelled':
        return this.toPassenger(p.rideId, async () => ({
          title: 'Your driver cancelled',
          body: 'We are finding you another driver.',
        }));

      case 'ride.expired':
        return this.toPassenger(p.rideId, async () => ({
          title: 'No driver found',
          body: 'Try again, or offer a little more.',
        }));

      case 'ride.cancelled':
        if (p.by !== 'passenger' || !p.driverId) return;
        return this.devices.notify([p.driverId], {
          title: 'Ride cancelled',
          body: 'The passenger cancelled this ride.',
          data: { type: 'ride', rideId: p.rideId, role: 'driver' },
          channel: 'general',
          tag: `ride-${p.rideId}`,
        });

      case 'ride.message': {
        const sender = await this.prisma.user.findUnique({
          where: { id: p.senderId },
          select: { name: true },
        });
        return this.devices.notify([p.recipientId], {
          title:
            sender?.name ??
            (p.senderRole === 'driver' ? 'Your driver' : 'Your passenger'),
          body: String(p.body).slice(0, 180),
          data: {
            type: 'chat',
            rideId: p.rideId,
            role: p.senderRole === 'driver' ? 'passenger' : 'driver',
          },
          channel: 'general',
          tag: `chat-${p.rideId}`,
        });
      }

      case 'driver.offline':
        return this.devices.notify([p.userId], {
          title: 'You are offline',
          body: 'We lost your location for a while. Go online again to get rides.',
          data: { type: 'driver_home' },
          channel: 'general',
          tag: 'driver-status',
        });

      case 'wallet.request_reviewed':
        return this.devices.notify([p.userId], this.reviewed(p));

      case 'wallet.change_received':
        return this.devices.notify([p.userId], {
          title: `${rs(p.amount)} added to your wallet`,
          body: `${p.driverName ?? 'Your driver'} put your change into your wallet.`,
          data: { type: 'wallet' },
          channel: 'general',
        });
    }
  }

  // A driver is asked to take a ride or freight job. Loud channel, and gone
  // if it could not be delivered before the offer ran out.
  private async newRequest(
    rideId: string,
    driverId: string,
    expiresAt?: string | Date,
  ) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        service: true,
        pickupAddress: true,
        dropoffAddress: true,
        offeredFare: true,
        estimatedFare: true,
        paymentMethod: true,
      },
    });
    if (!ride) return;
    const left = expiresAt
      ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      : 30;
    if (left <= 0) return;
    const freight = ride.service === 'freight';
    await this.devices.notify([driverId], {
      title: freight ? 'New freight request' : 'New ride request',
      body: `${short(ride.pickupAddress)} → ${short(ride.dropoffAddress)} · ${rs(ride.offeredFare ?? ride.estimatedFare)}${ride.paymentMethod === 'wallet' ? ' · Wallet' : ''}`,
      data: { type: 'ride_offer', rideId },
      channel: 'ride_requests',
      ttlSeconds: left,
      tag: `offer-${rideId}`,
    });
  }

  private async newBid(rideId: string, driverId: string) {
    const offer = await this.prisma.rideOffer.findFirst({
      where: { rideId, driverId },
      select: {
        bidAmount: true,
        ride: { select: { passengerId: true } },
        driver: { select: { name: true } },
      },
    });
    if (!offer?.bidAmount) return;
    await this.devices.notify([offer.ride.passengerId], {
      title: 'New offer',
      body: `${offer.driver.name ?? 'A driver'} offers ${rs(offer.bidAmount)}. Tap to choose.`,
      data: { type: 'ride', rideId, role: 'passenger' },
      channel: 'general',
      tag: `bids-${rideId}`,
    });
  }

  private async toPassenger(
    rideId: string,
    compose: (ride: {
      driverName: string | null;
      vehicle: string | null;
    }) => Promise<{ title: string; body: string }>,
  ) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        passengerId: true,
        driver: { select: { name: true } },
        vehicle: { select: { make: true, model: true, color: true } },
      },
    });
    if (!ride) return;
    const v = ride.vehicle;
    const text = await compose({
      driverName: ride.driver?.name ?? null,
      vehicle: v ? `${v.color} ${v.make} ${v.model}`.trim() : null,
    });
    await this.devices.notify([ride.passengerId], {
      ...text,
      data: { type: 'ride', rideId, role: 'passenger' },
      channel: 'general',
      tag: `ride-${rideId}`,
    });
  }

  // Ride Later. Returns false when the event is not about a booking (an
  // ordinary ride that expired), so the usual message goes out instead.
  private async booking(type: string, p: any): Promise<boolean> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: p.rideId },
      select: {
        passengerId: true,
        driverId: true,
        scheduledAt: true,
        service: true,
        pickupAddress: true,
        dropoffAddress: true,
        fare: true,
        offeredFare: true,
        estimatedFare: true,
        driver: { select: { name: true } },
        vehicle: { select: { make: true, model: true, color: true } },
      },
    });
    if (!ride?.scheduledAt) return false;
    const when = bookingTime(ride.scheduledAt, this.tzOffset);
    const route = `${short(ride.pickupAddress)} → ${short(ride.dropoffAddress)}`;
    const driver = ride.driver?.name ?? 'Your driver';
    const v = ride.vehicle;
    const vehicle = v ? ` (${`${v.color} ${v.make} ${v.model}`.trim()})` : '';
    const forPassenger = (title: string, body: string) =>
      this.devices.notify([ride.passengerId], {
        title,
        body,
        data: { type: 'booking', rideId: p.rideId, role: 'passenger' },
        channel: 'general',
        tag: `booking-${p.rideId}`,
      });
    const forDriver = (driverId: string, title: string, body: string) =>
      this.devices.notify([driverId], {
        title,
        body,
        data: { type: 'booking', rideId: p.rideId, role: 'driver' },
        channel: 'general',
        tag: `booking-${p.rideId}`,
      });

    switch (type) {
      case 'booking.created':
        if (!p.driverIds?.length) return true;
        await this.devices.notify(p.driverIds, {
          title: `New booking: ${when}`,
          body: `${route} · ${rs(ride.offeredFare ?? ride.estimatedFare)}. Send your price.`,
          data: { type: 'booking_job', rideId: p.rideId },
          channel: 'general',
          tag: `booking-${p.rideId}`,
        });
        return true;

      case 'ride.reservation_confirmed':
        await forDriver(
          p.driverId,
          'Booking confirmed',
          `${when} · ${route}. Press Start on the day when you head to the pickup.`,
        );
        return true;

      case 'ride.reservation_released':
        if (p.by === 'passenger') {
          await forDriver(
            p.driverId,
            'Booking taken back',
            `The customer is looking for another driver for ${when}.`,
          );
        } else {
          await forPassenger(
            'Your driver gave up the booking',
            `Other drivers can offer again for ${when}.`,
          );
        }
        return true;

      case 'ride.expired':
        await forPassenger(
          `No driver took your ${when} booking`,
          'Book a ride now, or schedule again with a higher price.',
        );
        return true;

      case 'booking.missed':
        await forPassenger(
          `${driver} did not come`,
          'Book a ride now, or schedule again.',
        );
        await forDriver(
          p.driverId,
          'Booking missed',
          `You did not start the ${route} booking. Missed bookings can stop you taking bookings.`,
        );
        return true;

      case 'booking.reminder':
        switch (p.kind) {
          case 'no_driver_first':
          case 'no_driver_second':
            await forPassenger(
              `No driver yet for ${when}`,
              'Raise your price so more drivers offer, or book a ride now.',
            );
            break;
          case 'evening_before':
          case 'upcoming':
            await forPassenger(
              `Your ride ${when}`,
              `${driver}${vehicle} is booked. ${route}.`,
            );
            if (ride.driverId) {
              await forDriver(
                ride.driverId,
                `Booking ${when}`,
                `${route} · ${rs(ride.fare ?? ride.estimatedFare)}. Press Start when you head out.`,
              );
            }
            break;
          case 'start_nudge':
            if (ride.driverId) {
              await forDriver(
                ride.driverId,
                `Time to start your ${when} booking`,
                `Press Start and head to ${short(ride.pickupAddress)}.`,
              );
            }
            break;
          case 'not_started':
            await forPassenger(
              `${driver} has not started yet`,
              'Call them, or get offers from other drivers.',
            );
            break;
        }
        return true;
    }
    return false;
  }

  private reviewed(p: {
    kind: 'topup' | 'withdrawal';
    status: 'approved' | 'rejected';
    amount: number;
    reason?: string | null;
  }): PushMessage {
    const amount = rs(p.amount);
    const approved = p.status === 'approved';
    return {
      title:
        p.kind === 'topup'
          ? approved
            ? `${amount} added to your wallet`
            : 'Top-up not approved'
          : approved
            ? `${amount} withdrawal sent`
            : 'Withdrawal not approved',
      body: approved
        ? p.kind === 'topup'
          ? 'Your top-up was checked and added.'
          : 'The money is on its way to your account.'
        : (p.reason ?? 'Open your wallet for details.'),
      data: { type: 'wallet' },
      channel: 'general',
    };
  }
}
