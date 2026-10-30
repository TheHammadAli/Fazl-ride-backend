import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseGoogleCerts,
  tokenKeyId,
  verifyGoogleIdToken,
} from './google-id-token.js';

// Real RSA signing with a key of our own standing in for Google's.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = parseGoogleCerts({
  keys: [
    { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' },
    { kid: 'broken', kty: 'RSA' },
  ],
});
const audiences = ['web-client', 'android-client'];
const now = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(
  claims: Record<string, unknown> = {},
  opts: { kid?: string; key?: KeyObject; alg?: string } = {},
) {
  const header = b64({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' });
  const payload = b64({
    iss: 'https://accounts.google.com',
    aud: 'web-client',
    sub: '1234',
    email: 'Ali@Gmail.com',
    email_verified: true,
    name: ' Ali Khan ',
    iat: now - 10,
    exp: now + 3600,
    ...claims,
  });
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    opts.key ?? privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const check = (idToken: string) =>
  verifyGoogleIdToken(idToken, keys, audiences, now);

describe('verifyGoogleIdToken', () => {
  it('returns who signed in, email lowercased and name trimmed', () => {
    expect(check(token())).toEqual({
      sub: '1234',
      email: 'ali@gmail.com',
      name: 'Ali Khan',
    });
    expect(check(token({ name: undefined }))?.name).toBeNull();
  });

  it("takes both of Google's issuer spellings and email_verified as text", () => {
    expect(check(token({ iss: 'accounts.google.com' }))).not.toBeNull();
    expect(check(token({ email_verified: 'true' }))).not.toBeNull();
    expect(check(token({ aud: 'android-client' }))).not.toBeNull();
  });

  it('refuses a token meant for someone else or not from Google', () => {
    expect(check(token({ aud: 'another-app' }))).toBeNull();
    expect(check(token({ iss: 'evil.example' }))).toBeNull();
  });

  it('refuses an expired token, or one from the future', () => {
    expect(check(token({ exp: now - 120 }))).toBeNull();
    expect(check(token({ iat: now + 600 }))).toBeNull();
    // A minute's grace for clocks a little apart.
    expect(check(token({ exp: now - 30 }))).not.toBeNull();
  });

  it('needs an email Google has verified', () => {
    expect(check(token({ email_verified: false }))).toBeNull();
    expect(check(token({ email: undefined }))).toBeNull();
    expect(check(token({ sub: '' }))).toBeNull();
  });

  it("refuses anything not signed with Google's key", () => {
    expect(check(token({}, { key: stranger.privateKey }))).toBeNull();
    expect(check(token({}, { kid: 'unknown' }))).toBeNull();
    expect(check(token({}, { alg: 'none' }))).toBeNull();
    expect(check('not.a.token')).toBeNull();
    expect(check('')).toBeNull();

    const [header, , signature] = token().split('.');
    const forged = b64({
      iss: 'https://accounts.google.com',
      aud: 'web-client',
      sub: '999',
      email: 'x@y.z',
      email_verified: true,
      exp: now + 99,
    });
    expect(check(`${header}.${forged}.${signature}`)).toBeNull();
  });
});

describe('parseGoogleCerts / tokenKeyId', () => {
  it('keeps the keys it can read, by kid', () => {
    expect([...keys.keys()]).toEqual(['k1']);
    expect(parseGoogleCerts(null).size).toBe(0);
    expect(parseGoogleCerts({ keys: 'nope' }).size).toBe(0);
  });

  it("reads the kid from a token's header", () => {
    expect(tokenKeyId(token({}, { kid: 'abc' }))).toBe('abc');
    expect(tokenKeyId('garbage')).toBeNull();
  });
});
