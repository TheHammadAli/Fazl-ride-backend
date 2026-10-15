import { describe, expect, it } from 'vitest';
import { DomainEvents } from '../events/domain-events.service.js';
import {
  bookingTime,
  PushNotificationsService,
} from './push-notifications.service.js';
import type { PushMessage } from './push.provider.js';

// Which events become which notifications, with the database and Firebase
// replaced by fakes.
function setup(ride: Record<string, unknown> = {}) {
  const events = new DomainEvents();
  const sent: { to: string[]; message: PushMessage }[] = [];
  const devices = {
    notify: async (to: string[], message: PushMessage) => {
      sent.push({ to, message });
    },
  };
  const prisma = {
    ride: {
      findUnique: async () => ({
        passengerId: 'p1',
        service: 'ride',
        pickupAddress: 'F-6 Markaz, Islamabad',
        dropoffAddress: 'Faisal Mosque, Islamabad',
        offeredFare: 350,
        estimatedFare: 300,
        paymentMethod: 'cash',
        driver: { name: 'Ali' },
        vehicle: { make: 'Honda', model: 'CD 70', color: 'Red' },
        ...ride,
      }),
    },
    rideOffer: {
      findFirst: async () => ({
        bidAmount: 400,
        ride: { passengerId: 'p1' },
        driver: { name: 'Ali' },
      }),
    },
    user: { findUnique: async () => ({ name: 'Sara' }) },
  };
  const config = { get: () => undefined };
  const service = new PushNotificationsService(
    events,
    devices as never,
    prisma as never,
    config as never,
  );
  service.onModuleInit();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { events, sent, settle };
}

describe('PushNotificationsService', () => {
  it('rings the driver for a new ride request, only while it is open', async () => {
    const { events, sent, settle } = setup();
    events.emit('ride.offer.created', {
      rideId: 'r1',
      driverId: 'd1',
      expiresAt: new Date(Date.now() + 30_000),
    });
    events.emit('ride.offer.created', {
      rideId: 'r2',
      driverId: 'd1',
      expiresAt: new Date(Date.now() - 1000),
    });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['d1']);
    expect(sent[0].message.channel).toBe('ride_requests');
    expect(sent[0].message.title).toBe('New ride request');
    expect(sent[0].message.body).toBe('F-6 Markaz → Faisal Mosque · Rs 350');
    expect(sent[0].message.ttlSeconds).toBeGreaterThan(25);
    expect(sent[0].message.data).toEqual({ type: 'ride_offer', rideId: 'r1' });
  });

  it('says freight for a freight request', async () => {
    const { events, sent, settle } = setup({ service: 'freight' });
    events.emit('ride.offer.created', {
      rideId: 'r1',
      driverId: 'd1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await settle();
    expect(sent[0].message.title).toBe('New freight request');
  });

  it('tells the passenger a driver was found, with the vehicle', async () => {
    const { events, sent, settle } = setup();
    events.emit('ride.accepted', { rideId: 'r1', driverId: 'd1' });
    await settle();
    expect(sent[0].to).toEqual(['p1']);
    expect(sent[0].message.body).toBe(
      'Ali is on the way in a Red Honda CD 70.',
    );
  });

  it('sends a chat message to the other person under the sender name', async () => {
    const { events, sent, settle } = setup();
    events.emit('ride.message', {
      rideId: 'r1',
      senderId: 'p1',
      senderRole: 'passenger',
      body: 'I am at the gate',
      recipientId: 'd1',
    });
    await settle();
    expect(sent[0].to).toEqual(['d1']);
    expect(sent[0].message.title).toBe('Sara');
    expect(sent[0].message.data.role).toBe('driver');
  });

  it('tells the driver only when the passenger cancels', async () => {
    const { events, sent, settle } = setup();
    events.emit('ride.cancelled', {
      rideId: 'r1',
      by: 'passenger',
      driverId: 'd1',
    });
    events.emit('ride.cancelled', {
      rideId: 'r2',
      by: 'passenger',
      driverId: null,
    });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['d1']);
  });

  it('tells both people when FAZL support cancels', async () => {
    const { events, sent, settle } = setup();
    events.emit('ride.cancelled', {
      rideId: 'r1',
      by: 'admin',
      driverId: 'd1',
      passengerId: 'p1',
    });
    await settle();
    expect(sent.map((s) => s.to)).toEqual([['p1'], ['d1']]);
    expect(sent[0].message.body).toContain('FAZL support');
  });

  it('explains a rejected top-up with the reason', async () => {
    const { events, sent, settle } = setup();
    events.emit('wallet.request_reviewed', {
      userId: 'p1',
      kind: 'topup',
      status: 'rejected',
      amount: 1000,
      reason: 'No transfer found',
    });
    await settle();
    expect(sent[0].message.title).toBe('Top-up not approved');
    expect(sent[0].message.body).toBe('No transfer found');
  });

  it('tells drivers near a new booking, with the time', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    const { events, sent, settle } = setup({ scheduledAt: tomorrow });
    events.emit('booking.created', { rideId: 'b1', driverIds: ['d1', 'd2'] });
    await settle();
    expect(sent[0].to).toEqual(['d1', 'd2']);
    expect(sent[0].message.title).toMatch(/^New booking: tomorrow /);
    expect(sent[0].message.data).toEqual({ type: 'booking_job', rideId: 'b1' });
  });

  it('warns the customer when nobody has offered yet', async () => {
    const soon = new Date(Date.now() + 3_600_000);
    const { events, sent, settle } = setup({ scheduledAt: soon });
    events.emit('booking.reminder', { rideId: 'b1', kind: 'no_driver_first' });
    await settle();
    expect(sent[0].to).toEqual(['p1']);
    expect(sent[0].message.title).toMatch(/^No driver yet for /);
  });

  it('says a booking expired differently from a ride', async () => {
    const past = new Date(Date.now() - 60_000);
    const booking = setup({ scheduledAt: past });
    booking.events.emit('ride.expired', { rideId: 'b1' });
    await booking.settle();
    expect(booking.sent[0].message.title).toMatch(/^No driver took your /);

    const ride = setup();
    ride.events.emit('ride.expired', { rideId: 'r1' });
    await ride.settle();
    expect(ride.sent[0].message.title).toBe('No driver found');
  });

  it('tells both people when the driver never started', async () => {
    const { events, sent, settle } = setup({
      scheduledAt: new Date(Date.now() - 3_600_000),
      driverId: 'd1',
    });
    events.emit('booking.missed', {
      rideId: 'b1',
      driverId: 'd1',
      passengerId: 'p1',
    });
    await settle();
    expect(sent.map((s) => s.to[0])).toEqual(['p1', 'd1']);
    expect(sent[0].message.title).toBe('Ali did not come');
  });
});

describe('bookingTime', () => {
  const now = new Date('2026-10-14T05:00:00Z'); // 10:00 AM in Pakistan
  it('says today, tomorrow, or the date', () => {
    expect(bookingTime(new Date('2026-10-14T15:30:00Z'), 300, now)).toBe(
      'today 8:30 PM',
    );
    expect(bookingTime(new Date('2026-10-15T03:30:00Z'), 300, now)).toBe(
      'tomorrow 8:30 AM',
    );
    expect(bookingTime(new Date('2026-10-17T03:30:00Z'), 300, now)).toBe(
      'Sat 17 Oct, 8:30 AM',
    );
  });
});
