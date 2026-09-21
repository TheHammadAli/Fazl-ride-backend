export interface SessionSpan {
  startedAt: Date;
  endedAt: Date | null;
}

// Seconds spent online inside [dayStart, now]. A session that began before
// dayStart only counts from dayStart, and one still open counts up to `now`.
export function onlineSecondsSince(
  sessions: SessionSpan[],
  dayStart: Date,
  now: Date,
): number {
  const ms = sessions.reduce((sum, s) => {
    const from = Math.max(s.startedAt.getTime(), dayStart.getTime());
    const to = Math.min((s.endedAt ?? now).getTime(), now.getTime());
    return sum + Math.max(0, to - from);
  }, 0);
  return Math.round(ms / 1000);
}
