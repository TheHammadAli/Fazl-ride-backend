import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';
import type { GoogleIdentity } from './google/google-id-token.js';

interface FakeUser {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  googleId: string | null;
  status: 'active' | 'blocked' | 'deleted';
}

const CODE = '123456';

// "Continue with Google" with the database and Google replaced by fakes; the
// texted code is DEV_OTP_BYPASS's, anything else finds no code.
function setup(users: Partial<FakeUser>[] = []) {
  const rows: FakeUser[] = users.map((u, i) => ({
    id: `u${i + 1}`,
    phone: `+92300000000${i + 1}`,
    name: null,
    email: null,
    googleId: null,
    status: 'active',
    ...u,
  }));
  const matches = (u: FakeUser, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object' && 'not' in value
        ? u[key as keyof FakeUser] !== (value as { not: unknown }).not
        : u[key as keyof FakeUser] === value,
    );
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((u) => matches(u, where)) ?? null,
      count: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((u) => matches(u, where)).length,
      upsert: async ({ where, create }: any) => {
        const found = rows.find((u) => u.phone === where.phone);
        if (found) return found;
        const user: FakeUser = {
          id: `u${rows.length + 1}`,
          phone: create.phone,
          name: null,
          email: null,
          googleId: null,
          status: 'active',
        };
        rows.push(user);
        return user;
      },
      update: async ({ where, data }: any) => {
        const user = rows.find((u) => u.id === where.id)!;
        return Object.assign(user, data);
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((u) => matches(u, where));
        hit.forEach((u) => Object.assign(u, data));
        return { count: hit.length };
      },
    },
    otpCode: { findFirst: async () => null },
    refreshToken: { create: async () => ({}) },
    userRole: { upsert: async () => ({}) },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const jwt = { signAsync: async (p: { sub: string }) => `access-${p.sub}` };
  const settings: Record<string, string> = {
    DEV_OTP_BYPASS: 'true',
    DEV_OTP_CODE: CODE,
  };
  const config = { get: (key: string) => settings[key] };
  // The "ID token" is just the key of the Google account it stands for.
  const accounts: Record<string, GoogleIdentity> = {
    sara: { sub: 'g-sara', email: 'sara@gmail.com', name: 'Sara Khan' },
    ali: { sub: 'g-ali', email: 'ali@gmail.com', name: null },
  };
  const google = {
    verify: async (idToken: string) => {
      const who = accounts[idToken];
      if (!who) throw new UnauthorizedException('Google sign-in failed');
      return who;
    },
  };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    config as never,
    {} as never,
    google as never,
  );
  return { service, rows };
}

describe('AuthService.googleSignIn', () => {
  it('asks a Google account it has never seen for a phone number', async () => {
    const { service } = setup();
    await expect(service.googleSignIn('sara')).resolves.toEqual({
      needsPhone: true,
      name: 'Sara Khan',
      email: 'sara@gmail.com',
    });
  });

  it('signs a linked Google account straight in', async () => {
    const { service } = setup([{ googleId: 'g-sara' }]);
    const result = await service.googleSignIn('sara');
    expect(result).toMatchObject({ accessToken: 'access-u1' });
  });

  it('never signs in by a matching email: profile emails are unverified', async () => {
    const { service, rows } = setup([{ email: 'sara@gmail.com' }]);
    await expect(service.googleSignIn('sara')).resolves.toMatchObject({
      needsPhone: true,
    });
    expect(rows[0].googleId).toBeNull();
  });

  it('turns away a blocked account, and starts over for a deleted one', async () => {
    const blocked = setup([{ googleId: 'g-sara', status: 'blocked' }]);
    await expect(blocked.service.googleSignIn('sara')).rejects.toThrow(
      ForbiddenException,
    );
    const deleted = setup([{ googleId: 'g-sara', status: 'deleted' }]);
    await expect(deleted.service.googleSignIn('sara')).resolves.toMatchObject({
      needsPhone: true,
    });
  });

  it('passes on a token Google would not vouch for', async () => {
    const { service } = setup();
    await expect(service.googleSignIn('forged')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthService.completeGoogleSignIn', () => {
  it('registers a new number with the confirmed name and Google email', async () => {
    const { service, rows } = setup();
    const result = await service.completeGoogleSignIn(
      'sara',
      '  Sara K. ',
      '+923001234567',
      CODE,
    );
    expect(result).toMatchObject({ accessToken: 'access-u1' });
    expect(rows).toEqual([
      expect.objectContaining({
        phone: '+923001234567',
        name: 'Sara K.',
        email: 'sara@gmail.com',
        googleId: 'g-sara',
      }),
    ]);
    // From now on Google alone signs her in.
    await expect(service.googleSignIn('sara')).resolves.toMatchObject({
      accessToken: 'access-u1',
    });
  });

  it("links an existing number, keeping the account's name and email", async () => {
    const { service, rows } = setup([
      { phone: '+923001234567', name: 'Driver Sara', email: 'old@mail.com' },
    ]);
    await service.completeGoogleSignIn('sara', 'Typed', '+923001234567', CODE);
    expect(rows[0]).toMatchObject({
      name: 'Driver Sara',
      email: 'old@mail.com',
      googleId: 'g-sara',
    });
  });

  it("leaves the email off when another account already has it", async () => {
    const { service, rows } = setup([{ email: 'sara@gmail.com' }]);
    await service.completeGoogleSignIn('sara', 'Sara', '+923001234567', CODE);
    expect(rows[1]).toMatchObject({ email: null, googleId: 'g-sara' });
    expect(rows[0].email).toBe('sara@gmail.com');
  });

  it('needs the right code, and uses nothing up without it', async () => {
    const { service, rows } = setup();
    await expect(
      service.completeGoogleSignIn('sara', 'Sara', '+923001234567', '000000'),
    ).rejects.toThrow(UnauthorizedException);
    expect(rows).toHaveLength(0);
  });

  it('refuses a Google account linked to another number', async () => {
    const { service } = setup([{ googleId: 'g-sara' }]);
    await expect(
      service.completeGoogleSignIn('sara', 'Sara', '+923001234567', CODE),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a number linked to another Google account', async () => {
    const { service } = setup([{ phone: '+923001234567', googleId: 'g-ali' }]);
    await expect(
      service.completeGoogleSignIn('sara', 'Sara', '+923001234567', CODE),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a blocked number', async () => {
    const { service } = setup([{ phone: '+923001234567', status: 'blocked' }]);
    await expect(
      service.completeGoogleSignIn('sara', 'Sara', '+923001234567', CODE),
    ).rejects.toThrow(ForbiddenException);
  });

  it("moves a deleted account's Google link to the new one", async () => {
    const { service, rows } = setup([
      { phone: 'deleted:u1', googleId: 'g-sara', status: 'deleted' },
    ]);
    await service.completeGoogleSignIn('sara', 'Sara', '+923001234567', CODE);
    expect(rows[0].googleId).toBeNull();
    expect(rows[1]).toMatchObject({ phone: '+923001234567', googleId: 'g-sara' });
  });
});
