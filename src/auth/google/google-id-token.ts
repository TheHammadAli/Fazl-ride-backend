import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

// Checking a Google ID token ("Continue with Google") with Node's own
// crypto: no library needed. Pure functions; GoogleCertsVerifier wraps them
// with the key download and the app's client IDs.

/** Who Google says signed in, from a token that checked out. */
export interface GoogleIdentity {
  /** Google's own stable id for the account. */
  sub: string;
  /** Lowercased; Google has verified it belongs to the person. */
  email: string;
  name: string | null;
}

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Google's signing keys by `kid`, from the body of [GOOGLE_CERTS_URL]. */
export function parseGoogleCerts(body: unknown): Map<string, KeyObject> {
  const keys =
    (body as { keys?: (JsonWebKey & { kid?: unknown })[] } | null)?.keys ?? [];
  const byId = new Map<string, KeyObject>();
  for (const jwk of keys) {
    if (typeof jwk.kid !== 'string') continue;
    try {
      byId.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    } catch {
      // A key we can't read is skipped; tokens signed with it won't check out.
    }
  }
  return byId;
}

/** The `kid` a token's header names, or null for something that isn't a JWT. */
export function tokenKeyId(idToken: string): string | null {
  const header = decodePart(idToken.split('.')[0]);
  return typeof header?.kid === 'string' ? header.kid : null;
}

/**
 * Checks a Google ID token all the way: signed (RS256) by one of Google's
 * [keys], issued by Google, meant for one of [audiences] (this app's OAuth
 * client IDs), not expired, and with an email Google has verified. Returns
 * who it is, or null if anything is off.
 */
export function verifyGoogleIdToken(
  idToken: string,
  keys: Map<string, KeyObject>,
  audiences: string[],
  nowSeconds = Math.floor(Date.now() / 1000),
): GoogleIdentity | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodePart(headerPart);
  const claims = decodePart(payloadPart);
  if (!header || !claims) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const key = keys.get(header.kid);
  if (!key) return null;
  const signed = verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    key,
    Buffer.from(signaturePart, 'base64url'),
  );
  if (!signed) return null;

  if (!GOOGLE_ISSUERS.includes(claims.iss as string)) return null;
  if (typeof claims.aud !== 'string' || !audiences.includes(claims.aud)) {
    return null;
  }
  // A minute's grace either way for clocks a little apart.
  if (typeof claims.exp !== 'number' || claims.exp + 60 < nowSeconds) {
    return null;
  }
  if (typeof claims.iat === 'number' && claims.iat - 60 > nowSeconds) {
    return null;
  }
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  const emailVerified =
    claims.email_verified === true || claims.email_verified === 'true';
  if (typeof claims.email !== 'string' || !claims.email || !emailVerified) {
    return null;
  }
  const name = typeof claims.name === 'string' ? claims.name.trim() : '';
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: name || null,
  };
}

function decodePart(part: string | undefined): Record<string, unknown> | null {
  if (!part) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, 'base64url').toString('utf8'),
    );
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
