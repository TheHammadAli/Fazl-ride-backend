import { describe, expect, it } from 'vitest';
import { DomainEvents } from '../events/domain-events.service.js';
import { PushNotificationsService } from './push-notifications.service.js';
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
  const service = new PushNotificationsService(
    events,
    devices as never,
    prisma as never,
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
});
