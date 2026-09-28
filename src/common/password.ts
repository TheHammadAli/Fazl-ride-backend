import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Passwords for the web admin panel only (everyone else logs in with an OTP).
// scrypt is built into Node, so this needs no extra package. Stored as
// `scrypt$N$salt$hash` so the cost can be raised later without a migration.
const COST = 16384;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: cost, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt$${COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// `stored` may be missing (unknown email, or an account with no password):
// the same amount of work is still done so the response time does not tell
// an attacker which emails exist.
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const parts = stored?.split('$');
  if (!parts || parts.length !== 4 || parts[0] !== 'scrypt') {
    await derive(password, Buffer.alloc(16), COST);
    return false;
  }
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  if (!Number.isInteger(cost) || cost < 1024 || expected.length !== KEY_LENGTH) {
    await derive(password, Buffer.alloc(16), COST);
    return false;
  }
  const actual = await derive(password, salt, cost);
  return timingSafeEqual(actual, expected);
}
