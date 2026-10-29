import { Role } from '../../generated/prisma/enums.js';

/**
 * A Fazl Admin staff account, as the Fazl Admin backend (Fazlapp-Backend1)
 * describes it at GET /admins/me.
 */
export interface FazlStaff {
  id: string;
  name: string | null;
  /** super_admin, admin, subadmin; a member (moderator) is "moderator". */
  roles: string[];
  permissions: { page: string; actions: string[] }[];
  isDisabled: boolean;
}

export interface RideAccess {
  role: typeof Role.admin | typeof Role.super_admin;
  /** Their "Fazl Ride" permission is view only: they may read, not change. */
  readOnly: boolean;
}

/** The page Fazl Admin's super admin grants to let an admin into Fazl Ride. */
export const RIDE_PERMISSION_PAGE = 'ride';

/** The account kept here for a Fazl Admin staff member. `phone` is required
 *  and unique but this account never uses one, like the bootstrap admin's. */
export function fazlAdminPhone(staffId: string): string {
  return `fazl-admin:${staffId}`;
}

/** The staff account in a GET /admins/me answer, or null for any other shape. */
export function parseFazlStaff(body: unknown): FazlStaff | null {
  const data = (body as { data?: unknown } | null)?.data as
    | Record<string, unknown>
    | undefined;
  if (!data || typeof data.id !== 'string' || !data.id) return null;
  const roles = Array.isArray(data.roles)
    ? data.roles.filter((r): r is string => typeof r === 'string')
    : [];
  const permissions = Array.isArray(data.permissions)
    ? data.permissions.flatMap((p: unknown) => {
        const entry = p as { page?: unknown; actions?: unknown } | null;
        if (typeof entry?.page !== 'string') return [];
        const actions = Array.isArray(entry.actions)
          ? entry.actions.filter((a): a is string => typeof a === 'string')
          : [];
        return [{ page: entry.page, actions }];
      })
    : [];
  const name =
    typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null;
  return { id: data.id, name, roles, permissions, isDisabled: data.isDisabled === true };
}

/**
 * What a Fazl Admin staff member may do in Fazl Ride, matching how the panel
 * itself decides: a super admin everything; an admin or sub-admin only with
 * the "ride" permission, view only unless it also allows edit or delete; a
 * member (moderator) or a disabled account nothing.
 */
export function rideAccessFor(staff: FazlStaff): RideAccess | null {
  if (staff.isDisabled) return null;
  if (staff.roles.includes('super_admin')) {
    return { role: Role.super_admin, readOnly: false };
  }
  if (!staff.roles.includes('admin') && !staff.roles.includes('subadmin')) {
    return null;
  }
  const entry = staff.permissions.find((p) => p.page === RIDE_PERMISSION_PAGE);
  if (!entry) return null;
  const canChange = entry.actions.some((a) => a === 'edit' || a === 'delete');
  return { role: Role.admin, readOnly: !canChange };
}
