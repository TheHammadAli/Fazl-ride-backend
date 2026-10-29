import { describe, expect, it } from 'vitest';
import { FazlStaff, parseFazlStaff, rideAccessFor } from './fazl-admin.js';

const staff = (over: Partial<FazlStaff> = {}): FazlStaff => ({
  id: 'a1',
  name: 'Sara',
  roles: ['admin'],
  permissions: [],
  isDisabled: false,
  ...over,
});

describe('parseFazlStaff', () => {
  it('reads an admin from GET /admins/me', () => {
    expect(
      parseFazlStaff({
        data: {
          id: 'a1',
          _id: 'a1',
          name: ' Sara ',
          role: 'admin',
          roles: ['admin'],
          permissions: [{ page: 'ride', actions: ['view', 'edit'] }],
          isDisabled: false,
          email: 'sara@fazl.io',
        },
      }),
    ).toEqual({
      id: 'a1',
      name: 'Sara',
      roles: ['admin'],
      permissions: [{ page: 'ride', actions: ['view', 'edit'] }],
      isDisabled: false,
    });
  });

  it('reads a member, who has no permissions', () => {
    expect(
      parseFazlStaff({ data: { id: 'm1', name: '', roles: ['moderator'] } }),
    ).toEqual({
      id: 'm1',
      name: null,
      roles: ['moderator'],
      permissions: [],
      isDisabled: false,
    });
  });

  it('turns down any other shape', () => {
    expect(parseFazlStaff(null)).toBeNull();
    expect(parseFazlStaff({})).toBeNull();
    expect(parseFazlStaff({ data: { name: 'No id' } })).toBeNull();
    expect(parseFazlStaff({ data: { id: 42 } })).toBeNull();
  });

  it('drops malformed permission entries', () => {
    const parsed = parseFazlStaff({
      data: {
        id: 'a1',
        roles: ['admin', 7],
        permissions: [null, { actions: ['view'] }, { page: 'ride', actions: 'edit' }],
      },
    });
    expect(parsed?.roles).toEqual(['admin']);
    expect(parsed?.permissions).toEqual([{ page: 'ride', actions: [] }]);
  });
});

describe('rideAccessFor', () => {
  it('lets a super admin do everything, permissions or not', () => {
    expect(rideAccessFor(staff({ roles: ['super_admin'] }))).toEqual({
      role: 'super_admin',
      readOnly: false,
    });
  });

  it('lets an admin or sub-admin in only with the ride permission', () => {
    expect(rideAccessFor(staff())).toBeNull();
    expect(
      rideAccessFor(
        staff({ permissions: [{ page: 'users', actions: ['view', 'edit'] }] }),
      ),
    ).toBeNull();
    expect(
      rideAccessFor(
        staff({
          roles: ['subadmin'],
          permissions: [{ page: 'ride', actions: ['view', 'edit'] }],
        }),
      ),
    ).toEqual({ role: 'admin', readOnly: false });
  });

  it('keeps a view-only ride permission to reading', () => {
    expect(
      rideAccessFor(staff({ permissions: [{ page: 'ride', actions: ['view'] }] })),
    ).toEqual({ role: 'admin', readOnly: true });
    expect(
      rideAccessFor(
        staff({ permissions: [{ page: 'ride', actions: ['view', 'delete'] }] }),
      ),
    ).toEqual({ role: 'admin', readOnly: false });
  });

  it('never lets in a member or a disabled account', () => {
    expect(
      rideAccessFor(
        staff({
          roles: ['moderator'],
          permissions: [{ page: 'ride', actions: ['view', 'edit'] }],
        }),
      ),
    ).toBeNull();
    expect(
      rideAccessFor(staff({ roles: ['super_admin'], isDisabled: true })),
    ).toBeNull();
  });
});
