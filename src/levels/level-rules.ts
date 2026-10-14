// Driver achievement levels (lifetime): which level a number of completed
// trips reaches, what is next, and the rewards' maths. No database here.

export interface LevelRule {
  key: string;
  name: string;
  minRides: number;
  active: boolean;
}

const byRides = <T extends LevelRule>(levels: T[]) =>
  levels.filter((l) => l.active).sort((a, b) => a.minRides - b.minRides);

// The highest level reached, or null below the first one.
export function levelFor<T extends LevelRule>(
  trips: number,
  levels: T[],
): T | null {
  return (
    byRides(levels)
      .filter((l) => l.minRides <= trips)
      .at(-1) ?? null
  );
}

export function nextLevel<T extends LevelRule>(
  trips: number,
  levels: T[],
): T | null {
  return byRides(levels).find((l) => l.minRides > trips) ?? null;
}

// Levels reached now that were not reached before (several at once when a
// driver who already had many trips is counted for the first time). Each
// gives its own bonus once.
// The previous level is looked up among all levels, active or not: one an
// admin turned off still counts as reached (no "congratulations" for a
// lower level the driver had already passed).
export function newlyReached<T extends LevelRule>(
  previousKey: string | null,
  trips: number,
  levels: T[],
): T[] {
  const previous = levels.find((l) => l.key === previousKey);
  const floor = previous?.minRides ?? -1;
  return byRides(levels).filter(
    (l) => l.minRides > floor && l.minRides <= trips,
  );
}

// Progress towards the next level: "742 of 1,000, 258 to go".
export function progress(
  trips: number,
  current: LevelRule | null,
  next: LevelRule | null,
) {
  if (!next)
    return { from: current?.minRides ?? 0, to: null, left: 0, fraction: 1 };
  const from = current?.minRides ?? 0;
  const span = Math.max(1, next.minRides - from);
  return {
    from,
    to: next.minRides,
    left: next.minRides - trips,
    fraction: Math.min(1, Math.max(0, (trips - from) / span)),
  };
}

// The commission after a level's discount; never below zero.
export function discountedPercent(percent: number, discount: number): number {
  return Math.max(0, percent - Math.max(0, discount));
}

// Who gets a request first: nearest, with a level's priority counting as
// that many metres closer.
export function byPriority<
  T extends { userId: string; distanceMeters: number },
>(drivers: T[], priorityMeters: Map<string, number>): T[] {
  const score = (d: T) =>
    d.distanceMeters - (priorityMeters.get(d.userId) ?? 0);
  return [...drivers].sort((a, b) => score(a) - score(b));
}
