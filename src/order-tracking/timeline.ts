export interface StatusStep {
  key: string;
  label: string;
  position: number;
  terminal: boolean;
  active: boolean;
}

export interface StatusEventRef {
  statusKey: string;
  at: Date;
}

export interface TimelineEntry {
  key: string;
  label: string;
  // When this step was reached; null if it has not been (or was skipped).
  reachedAt: Date | null;
  // Steps up to and including the current one are done, even if the other system skipped one.
  done: boolean;
  current: boolean;
}

// The list the customer sees: every step with the time it was reached. A step
// that ends the order in an unusual way (cancelled) only shows once reached; the
// normal ending (the first finishing step, "delivered") is always shown.
export function buildTimeline(
  steps: StatusStep[],
  events: StatusEventRef[],
  currentKey: string,
): TimelineEntry[] {
  const ordered = steps
    .filter((s) => s.active || s.key === currentKey)
    .sort((a, b) => a.position - b.position);
  const current = ordered.find((s) => s.key === currentKey);
  const normalEnd = ordered.find((s) => s.terminal);
  const reachedAt = new Map<string, Date>();
  for (const e of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    reachedAt.set(e.statusKey, e.at); // the latest time wins if a step was repeated
  }

  return ordered
    .filter(
      (s) =>
        !s.terminal ||
        s.key === normalEnd?.key ||
        reachedAt.has(s.key) ||
        s.key === currentKey,
    )
    .map((s) => ({
      key: s.key,
      label: s.label,
      reachedAt: reachedAt.get(s.key) ?? null,
      done:
        reachedAt.has(s.key) ||
        (current ? s.position < current.position : false) ||
        s.key === currentKey,
      current: s.key === currentKey,
    }));
}
