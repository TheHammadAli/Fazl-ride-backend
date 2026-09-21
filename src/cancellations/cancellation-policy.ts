export interface CancelRule {
  // This many cancellations ...
  limit: number;
  // ... within this long ...
  windowMs: number;
  // ... blocks the person for this long, counted from the cancellation that hit the limit.
  cooldownMs: number;
}

// Returns until when the person is blocked, or null if they are free now.
// `times` are the moments they cancelled; only those that still matter need to be passed.
export function cooldownUntil(
  times: Date[],
  now: Date,
  rule: CancelRule,
): Date | null {
  const sorted = times.map((t) => t.getTime()).sort((a, b) => a - b);
  let until = 0;
  for (let i = rule.limit - 1; i < sorted.length; i++) {
    // `limit` cancellations ending at sorted[i] all fit inside the window.
    if (sorted[i] - sorted[i - rule.limit + 1] <= rule.windowMs) {
      until = Math.max(until, sorted[i] + rule.cooldownMs);
    }
  }
  return until > now.getTime() ? new Date(until) : null;
}
