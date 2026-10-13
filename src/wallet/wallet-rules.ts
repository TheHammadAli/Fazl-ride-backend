// Pure money rules for wallets, kept apart from the database so they are easy
// to test. Every amount is whole PKR.

// The platform's share of a fare. Never more than the fare, never negative.
export function commissionFor(fare: number, percent: number): number {
  if (!(fare > 0) || !(percent > 0)) return 0;
  return Math.min(fare, Math.round((fare * percent) / 100));
}

// A driver's first [freeRides] completed trips carry no commission;
// [completedBefore] counts the ones finished before this one.
export function isFreeRide(
  completedBefore: number,
  freeRides: number,
): boolean {
  return completedBefore < freeRides;
}

// How many commission-free trips a driver still has.
export function freeRidesLeft(completed: number, freeRides: number): number {
  return Math.max(0, freeRides - completed);
}

// A ride paid "by wallet": the balance covers what it can and the rest is
// collected in cash, so a low balance never leaves a ride unpaid.
export function splitPayment(
  fare: number,
  balance: number,
): { walletPaid: number; cash: number } {
  const walletPaid = Math.max(0, Math.min(fare, balance));
  return { walletPaid, cash: fare - walletPaid };
}

// A driver whose balance (commission on cash rides) has gone below the
// allowed minimum must top up before going online again.
export function hasDues(balance: number, minBalance: number): boolean {
  return balance < minBalance;
}

// How much a driver must add to be allowed online again.
export function duesToClear(balance: number, minBalance: number): number {
  return hasDues(balance, minBalance) ? minBalance - balance : 0;
}
