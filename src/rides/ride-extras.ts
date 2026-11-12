import { normalizePkPhone } from '../common/phone.js';

// Options a customer can tick on a request (inDrive style). The apps show
// labels for these keys; an unknown key is refused so an old app cannot
// send something drivers would not understand.
export const RIDE_OPTIONS = [
  'luggage', // A lot of luggage
  'child', // Travelling with a child
  'pet', // Travelling with a pet
  'ac', // Please turn the AC on
  'wheelchair', // A folding wheelchair to carry
  'quiet', // Prefers a quiet ride
] as const;
export type RideOption = (typeof RIDE_OPTIONS)[number];

// The same list, in RIDE_OPTIONS order, without repeats.
export function cleanOptions(options: string[] | undefined): RideOption[] {
  const picked = new Set(options ?? []);
  return RIDE_OPTIONS.filter((o) => picked.has(o));
}

// A note with its spaces tidied; empty means no note.
export function cleanNote(note: string | undefined): string | null {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  return text.length ? text : null;
}

// Booked for someone else: a name and a Pakistani mobile number. Null when
// the rider is the customer themselves (nothing given, or their own number).
export function cleanRider(
  rider: { name: string; phone: string } | undefined,
  ownPhone: string,
): { name: string; phone: string } | null | 'bad_phone' {
  if (!rider) return null;
  const phone = normalizePkPhone(rider.phone);
  if (!phone) return 'bad_phone';
  if (phone === ownPhone) return null;
  return { name: rider.name.replace(/\s+/g, ' ').trim(), phone };
}
