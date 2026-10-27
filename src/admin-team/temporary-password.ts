import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: it is read off a screen and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

// A one-time password a super admin hands to a new admin; they must choose
// their own at first sign-in.
export function temporaryPassword(length = 14): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
