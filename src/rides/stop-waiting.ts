// Stops on the way (inDrive style) and what waiting at them costs.

// The most stops a passenger may add between the pickup and the final drop-off.
export const MAX_STOPS = 5;

export interface WaitingRates {
  freeWaitingMinutes: number;
  waitingPerMinute: number;
}

// Waiting at one stop: the first free minutes cost nothing, then every minute
// begun after them is charged. At most `capMinutes` are counted, so a driver
// who forgets to press Continue does not run up the bill. Whole PKR.
export function stopWaitingCharge(
  waitedSeconds: number,
  rates: WaitingRates,
  capMinutes: number,
): number {
  const counted = Math.min(Math.max(0, waitedSeconds), capMinutes * 60);
  const overSeconds = counted - Math.max(0, rates.freeWaitingMinutes) * 60;
  if (overSeconds <= 0 || rates.waitingPerMinute <= 0) return 0;
  return Math.round(Math.ceil(overSeconds / 60) * rates.waitingPerMinute);
}

// Seconds between arriving at a stop and leaving it (never negative).
export function waitedSeconds(arrivedAt: Date, departedAt: Date): number {
  return Math.max(
    0,
    Math.round((departedAt.getTime() - arrivedAt.getTime()) / 1000),
  );
}

// The waiting rates out of a ride's quoted rate snapshot; rides quoted before
// stops existed have none, and wait for free.
export function waitingRatesOf(rates: unknown): WaitingRates {
  const r = (rates ?? {}) as Partial<WaitingRates>;
  return {
    freeWaitingMinutes: Number(r.freeWaitingMinutes ?? 0) || 0,
    waitingPerMinute: Number(r.waitingPerMinute ?? 0) || 0,
  };
}
