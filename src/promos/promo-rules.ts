// Promo code maths and checks, kept pure so they can be tested without a
// database.

export interface PromoTerms {
  discountType: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minFare: number;
}

export interface PromoLimits {
  active: boolean;
  service: string | null;
  firstRideOnly: boolean;
  usageLimit: number | null;
  perUserLimit: number;
  startsAt: Date | null;
  expiresAt: Date | null;
}

export interface PromoUse {
  now: Date;
  service: string;
  // Uses that count: finished rides plus rides still open with this code.
  totalUses: number;
  userUses: number;
  // The person's completed trips before this one.
  completedTrips: number;
}

export type PromoProblem =
  | 'PROMO_INACTIVE'
  | 'PROMO_NOT_STARTED'
  | 'PROMO_EXPIRED'
  | 'PROMO_USED_UP'
  | 'PROMO_ALREADY_USED'
  | 'PROMO_FIRST_RIDE'
  | 'PROMO_SERVICE'
  | 'PROMO_MIN_FARE';

export const PROMO_MESSAGES: Record<PromoProblem, string> = {
  PROMO_INACTIVE: 'This promo code is not valid',
  PROMO_NOT_STARTED: 'This promo code is not active yet',
  PROMO_EXPIRED: 'This promo code has expired',
  PROMO_USED_UP: 'This promo code has been fully used',
  PROMO_ALREADY_USED: 'You have already used this promo code',
  PROMO_FIRST_RIDE: 'This promo code is for your first trip only',
  PROMO_SERVICE: 'This promo code does not apply to this service',
  PROMO_MIN_FARE: 'The fare is below this promo code’s minimum',
};

// Whole rupees off the fare; never more than the fare, 0 below the minimum.
export function discountFor(terms: PromoTerms, fare: number): number {
  if (fare <= 0 || fare < terms.minFare) return 0;
  let off =
    terms.discountType === 'percent'
      ? Math.floor((fare * terms.value) / 100)
      : terms.value;
  if (terms.maxDiscount != null) off = Math.min(off, terms.maxDiscount);
  return Math.max(0, Math.min(off, fare));
}

// Why this person cannot use the code for this trip now, or null.
export function promoProblem(
  promo: PromoLimits & PromoTerms,
  use: PromoUse,
  fare?: number,
): PromoProblem | null {
  if (!promo.active) return 'PROMO_INACTIVE';
  if (promo.startsAt && use.now < promo.startsAt) return 'PROMO_NOT_STARTED';
  if (promo.expiresAt && use.now >= promo.expiresAt) return 'PROMO_EXPIRED';
  if (promo.service && promo.service !== use.service) return 'PROMO_SERVICE';
  if (promo.firstRideOnly && use.completedTrips > 0) return 'PROMO_FIRST_RIDE';
  if (use.userUses >= promo.perUserLimit) return 'PROMO_ALREADY_USED';
  if (promo.usageLimit != null && use.totalUses >= promo.usageLimit)
    return 'PROMO_USED_UP';
  if (fare != null && fare < promo.minFare) return 'PROMO_MIN_FARE';
  return null;
}

// Codes are typed by people: trim, upper case.
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
