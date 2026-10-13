// Ride Later rules that need no database: when a confirmed driver may start
// a booking, which reminders are due, and when a booking is over. Times are
// milliseconds; minute settings come from BookingSettings.

export type BookingKind = 'ride' | 'freight' | 'intercity';

export interface BookingRules {
  rideStartBefore: number;
  rideStartAfter: number;
  freightStartBefore: number;
  freightStartAfter: number;
  intercityStartBefore: number;
  intercityStartAfter: number;
  rideWarnFirst: number;
  rideWarnSecond: number;
  freightWarnFirst: number;
  freightWarnSecond: number;
  intercityWarnFirst: number;
  intercityWarnSecond: number;
  reminderMinutes: number;
  startNudgeMinutes: number;
  eveningReminderHour: number;
}

const MIN = 60_000;

export function bookingKind(service: string, tripType: string): BookingKind {
  if (service === 'freight') return 'freight';
  return tripType === 'city_to_city' ? 'intercity' : 'ride';
}

// From when until when the confirmed driver may press Start.
export function startWindow(
  scheduledAt: Date,
  kind: BookingKind,
  r: BookingRules,
): { from: Date; until: Date } {
  const before = r[`${kind}StartBefore`];
  const after = r[`${kind}StartAfter`];
  return {
    from: new Date(scheduledAt.getTime() - before * MIN),
    until: new Date(scheduledAt.getTime() + after * MIN),
  };
}

export type ReminderKind =
  | 'evening_before'
  | 'no_driver_first'
  | 'no_driver_second'
  | 'upcoming'
  | 'start_nudge'
  | 'not_started';

// The evening before a booking, at `hour` in business time (offset in
// minutes, Pakistan = 300), or null when that is not usefully before it
// (a booking for the same evening or the early hours right after).
export function eveningBefore(
  scheduledAt: Date,
  hour: number,
  tzOffsetMinutes: number,
): Date | null {
  const local = new Date(scheduledAt.getTime() + tzOffsetMinutes * MIN);
  const evening = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - 1,
    hour,
  );
  const at = evening - tzOffsetMinutes * MIN;
  // At least 6 hours ahead, or it is not "the evening before".
  return scheduledAt.getTime() - at >= 6 * 60 * MIN ? new Date(at) : null;
}

// When each reminder for a booking is due. Which apply depends on whether a
// driver is confirmed.
export function reminderTimes(
  booking: { scheduledAt: Date; confirmed: boolean; kind: BookingKind },
  r: BookingRules,
  tzOffsetMinutes: number,
): Partial<Record<ReminderKind, Date>> {
  const at = booking.scheduledAt.getTime();
  const before = (minutes: number) => new Date(at - minutes * MIN);
  const evening = eveningBefore(
    booking.scheduledAt,
    r.eveningReminderHour,
    tzOffsetMinutes,
  );
  if (!booking.confirmed) {
    return {
      no_driver_first: before(r[`${booking.kind}WarnFirst`]),
      no_driver_second: before(r[`${booking.kind}WarnSecond`]),
    };
  }
  return {
    ...(evening && { evening_before: evening }),
    upcoming: before(r.reminderMinutes),
    start_nudge: before(r.startNudgeMinutes),
    not_started: new Date(at),
  };
}

// Reminders to send now: their time has come, they were not already past
// when the booking was made or confirmed (no stale "1 hour left" for a
// booking made 40 minutes ahead), and they are not long overdue (a server
// that was down does not send a pile of old ones).
export function dueReminders(
  times: Partial<Record<ReminderKind, Date>>,
  since: Date,
  now: Date,
  sent: Set<string>,
): ReminderKind[] {
  const stale = 30 * MIN;
  return (Object.entries(times) as [ReminderKind, Date][])
    .filter(
      ([kind, at]) =>
        !sent.has(kind) &&
        at.getTime() > since.getTime() &&
        at.getTime() <= now.getTime() &&
        now.getTime() - at.getTime() <= stale,
    )
    .map(([kind]) => kind);
}
