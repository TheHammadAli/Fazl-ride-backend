import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service.js';
import type { FazlStaff } from './fazl-admin/fazl-admin.js';

interface FakeUser {
  id: string;
  phone: string;
  name: string | null;
  status: 'active' | 'blocked' | 'deleted';
}

// Fazl Admin's panel opening Fazl Ride, with the database and the Fazl Admin
// backend replaced by fakes. The "Fazl Admin token" is the key of the staff
// account it stands for.
function setup(
  accounts: Record<string, FazlStaff>,
  users: FakeUser[] = [],
  roles: { userId: string; role: string }[] = [],
) {
  const rows = [...users];
  const userRoles = [...roles];
  const signed: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      upsert: async ({ where, update, create }: any) => {
        const found = rows.find((u) => u.phone === where.phone);
        if (found) return Object.assign(found, update);
        const user: FakeUser = {
          id: `u${rows.length + 1}`,
          name: null,
          status: 'active',
          ...create,
        };
        rows.push(user);
        return user;
      },
    },
    userRole: {
      deleteMany: async ({ where }: any) => {
        const ids = where.userId
          ? [where.userId]
          : rows.filter((u) => u.phone === where.user.phone).map((u) => u.id);
        const hit = (r: { userId: string; role: string }) =>
          ids.includes(r.userId) &&
          (typeof where.role === 'string'
            ? r.role === where.role
            : where.role.in.includes(r.role));
        const before = userRoles.length;
        for (let i = userRoles.length - 1; i >= 0; i--) {
          if (hit(userRoles[i])) userRoles.splice(i, 1);
        }
        return { count: before - userRoles.length };
      },
      upsert: async ({ where }: any) => {
        const { userId, role } = where.userId_role;
        if (!userRoles.some((r) => r.userId === userId && r.role === role)) {
          userRoles.push({ userId, role });
        }
        return {};
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const jwt = {
    signAsync: async (payload: Record<string, unknown>) => {
      signed.push(payload);
      return `access-${String(payload.sub)}`;
    },
  };
  const fazlAdmin = {
    verify: async (token: string) => {
      const who = accounts[token];
      if (!who) throw new UnauthorizedException('Your Fazl Admin login is not valid');
      return who;
    },
  };
  const service = new AuthService(
    prisma as never,
    jwt as never,
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    fazlAdmin as never,
  );
  const rolesOf = (userId: string) =>
    userRoles.filter((r) => r.userId === userId).map((r) => r.role);
  return { service, rows, rolesOf, signed };
}

const staff = (over: Partial<FazlStaff>): FazlStaff => ({
  id: 'a1',
  name: 'Sara',
  roles: ['admin'],
  permissions: [],
  isDisabled: false,
  ...over,
});

const RIDE_EDIT = [{ page: 'ride', actions: ['view', 'edit'] }];

describe('AuthService.fazlAdminLogin', () => {
  it("makes a super admin's account on the first visit and signs them in", async () => {
    const { service, rows, rolesOf, signed } = setup({
      boss: staff({ id: 'a1', name: 'Boss', roles: ['super_admin'] }),
    });
    await expect(service.fazlAdminLogin('boss')).resolves.toEqual({
      accessToken: 'access-u1',
      readOnly: false,
    });
    expect(rows).toEqual([
      { id: 'u1', phone: 'fazl-admin:a1', name: 'Boss', status: 'active' },
    ]);
    expect(rolesOf('u1')).toEqual(['super_admin']);
    // An access token only: no refresh token is made for these logins.
    expect(signed).toEqual([{ sub: 'u1' }]);
  });

  it('opens the same account on the next visit, with the name kept in step', async () => {
    const accounts = { sara: staff({ permissions: RIDE_EDIT }) };
    const { service, rows } = setup(accounts);
    await service.fazlAdminLogin('sara');
    accounts.sara = staff({ name: 'Sara Khan', permissions: RIDE_EDIT });
    await expect(service.fazlAdminLogin('sara')).resolves.toMatchObject({
      accessToken: 'access-u1',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Sara Khan');
  });

  it('marks a view-only permission in the token', async () => {
    const { service, rolesOf, signed } = setup({
      viewer: staff({ permissions: [{ page: 'ride', actions: ['view'] }] }),
    });
    await expect(service.fazlAdminLogin('viewer')).resolves.toEqual({
      accessToken: 'access-u1',
      readOnly: true,
    });
    expect(rolesOf('u1')).toEqual(['admin']);
    expect(signed).toEqual([{ sub: 'u1', readOnly: true }]);
  });

  it('moves the role with Fazl Admin: a super admin made an admin loses super_admin', async () => {
    const { service, rolesOf } = setup(
      { sara: staff({ permissions: RIDE_EDIT }) },
      [{ id: 'u1', phone: 'fazl-admin:a1', name: 'Sara', status: 'active' }],
      [{ userId: 'u1', role: 'super_admin' }],
    );
    await service.fazlAdminLogin('sara');
    expect(rolesOf('u1')).toEqual(['admin']);
  });

  it('turns away an account without the permission, and takes its admin role here', async () => {
    const { service, rolesOf } = setup(
      { sara: staff({ permissions: [{ page: 'users', actions: ['view'] }] }) },
      [{ id: 'u1', phone: 'fazl-admin:a1', name: 'Sara', status: 'active' }],
      [{ userId: 'u1', role: 'admin' }],
    );
    await expect(service.fazlAdminLogin('sara')).rejects.toThrow(
      ForbiddenException,
    );
    expect(rolesOf('u1')).toEqual([]);
  });

  it('turns away a member and a disabled account without making anything', async () => {
    const { service, rows } = setup({
      member: staff({ id: 'm1', roles: ['moderator'], permissions: RIDE_EDIT }),
      gone: staff({ roles: ['super_admin'], isDisabled: true }),
    });
    await expect(service.fazlAdminLogin('member')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.fazlAdminLogin('gone')).rejects.toThrow(
      ForbiddenException,
    );
    expect(rows).toEqual([]);
  });

  it('turns away an account blocked here', async () => {
    const { service } = setup(
      { boss: staff({ roles: ['super_admin'] }) },
      [{ id: 'u1', phone: 'fazl-admin:a1', name: 'Sara', status: 'blocked' }],
    );
    await expect(service.fazlAdminLogin('boss')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('passes on a login Fazl Admin does not accept', async () => {
    const { service } = setup({});
    await expect(service.fazlAdminLogin('forged')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
