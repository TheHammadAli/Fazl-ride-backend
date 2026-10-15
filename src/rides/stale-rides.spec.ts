import { describe, expect, it } from 'vitest';
import { staleReason } from './stale-rides.js';

const now = new Date('2026-10-15T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe('staleReason', () => {
  it('keeps a driver who is moving', () => {
    expect(
      staleReason(
        {
          status: 'accepted',
          requestedAt: ago(30),
          acceptedAt: ago(25),
          startedAt: null,
          driverSeenAt: ago(1),
        },
        now,
      ),
    ).toBeNull();
  });

  it('closes a ride whose driver went quiet on the way', () => {
    expect(
      staleReason(
        {
          status: 'accepted',
          requestedAt: ago(40),
          acceptedAt: ago(35),
          startedAt: null,
          driverSeenAt: ago(16),
        },
        now,
      ),
    ).toBe('driver_lost');
    expect(
      staleReason(
        {
          status: 'arrived',
          requestedAt: ago(40),
          acceptedAt: ago(35),
          startedAt: null,
          driverSeenAt: ago(20),
        },
        now,
      ),
    ).toBe('driver_lost');
  });

  it('counts from the accept when the driver never sent a position', () => {
    const ride = {
      status: 'accepted',
      requestedAt: ago(20),
      startedAt: null,
      driverSeenAt: null,
    };
    expect(staleReason({ ...ride, acceptedAt: ago(10) }, now)).toBeNull();
    expect(staleReason({ ...ride, acceptedAt: ago(16) }, now)).toBe(
      'driver_lost',
    );
  });

  it('gives a trip two hours without signal', () => {
    const trip = {
      status: 'started',
      requestedAt: ago(200),
      acceptedAt: ago(190),
      startedAt: ago(180),
    };
    expect(staleReason({ ...trip, driverSeenAt: ago(90) }, now)).toBeNull();
    expect(staleReason({ ...trip, driverSeenAt: ago(121) }, now)).toBe(
      'trip_lost',
    );
  });

  it('closes anything open for more than a day', () => {
    expect(
      staleReason(
        {
          status: 'started',
          requestedAt: ago(25 * 60),
          acceptedAt: ago(24 * 60),
          startedAt: ago(23 * 60),
          driverSeenAt: ago(1),
        },
        now,
      ),
    ).toBe('too_old');
  });

  it('leaves a ride still looking for a driver alone', () => {
    expect(
      staleReason(
        {
          status: 'requested',
          requestedAt: ago(60),
          acceptedAt: null,
          startedAt: null,
          driverSeenAt: null,
        },
        now,
      ),
    ).toBeNull();
  });

  it('never touches a booking for later, however far ahead', () => {
    expect(
      staleReason(
        {
          status: 'scheduled',
          requestedAt: ago(3 * 24 * 60),
          acceptedAt: null,
          startedAt: null,
          driverSeenAt: null,
        },
        now,
      ),
    ).toBeNull();
  });
});
