// When a ride under way has gone quiet for so long that nobody is still on
// it (the driver's phone died, the app was deleted...). Such a ride would
// keep the driver "busy" and the passenger unable to book again forever.

export type StaleReason = 'driver_lost' | 'trip_lost' | 'too_old';

export interface StaleLimits {
  /** Driver on the way / at the pickup: minutes without a position. */
  driverMinutes: number;
  /** On the trip: minutes without a position (long intercity trips lose signal). */
  tripMinutes: number;
  /** Any ride under way: hours since it was requested. */
  maxHours: number;
}

export const DEFAULT_STALE_LIMITS: StaleLimits = {
  driverMinutes: 15,
  tripMinutes: 120,
  maxHours: 24,
};

export interface UnderWay {
  status: string;
  requestedAt: Date;
  acceptedAt: Date | null;
  startedAt: Date | null;
  /** The driver's last position, if one ever arrived. */
  driverSeenAt: Date | null;
}

const MINUTE = 60_000;

const latest = (...dates: (Date | null)[]) =>
  Math.max(...dates.map((d) => d?.getTime() ?? 0));

/** Why this ride should be closed now, or null while it is alive. */
export function staleReason(
  ride: UnderWay,
  now: Date,
  limits: StaleLimits = DEFAULT_STALE_LIMITS,
): StaleReason | null {
  const t = now.getTime();
  // Only rides under way: a booking for later may be days ahead.
  if (!['requested', 'accepted', 'arrived', 'started'].includes(ride.status)) {
    return null;
  }
  if (t - ride.requestedAt.getTime() > limits.maxHours * 60 * MINUTE) {
    return 'too_old';
  }
  if (ride.status === 'accepted' || ride.status === 'arrived') {
    // Counted from the last sign of life: a position, or the accept itself.
    const alive = latest(ride.driverSeenAt, ride.acceptedAt, ride.requestedAt);
    return t - alive > limits.driverMinutes * MINUTE ? 'driver_lost' : null;
  }
  if (ride.status === 'started') {
    const alive = latest(ride.driverSeenAt, ride.startedAt, ride.requestedAt);
    return t - alive > limits.tripMinutes * MINUTE ? 'trip_lost' : null;
  }
  return null;
}

/** What the passenger, the driver and the admin are told. */
export const STALE_MESSAGE: Record<StaleReason, string> = {
  driver_lost:
    'The driver lost connection before the pickup, so this ride was closed. Please book again.',
  trip_lost:
    'This trip was closed because the driver’s phone stopped sending its location for a long time.',
  too_old: 'This ride was open for too long, so it was closed.',
};
