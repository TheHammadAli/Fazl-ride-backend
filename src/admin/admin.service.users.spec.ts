import { describe, expect, it } from 'vitest';
import { AdminService } from './admin.service.js';

// GET admin/users with the database replaced by a fake that keeps the query.
function setup() {
  const asked: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        asked.push(args.where);
        return [];
      },
      count: async () => 0,
      groupBy: async () => [],
    },
  };
  const service = new AdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, asked };
}

const NO_ADMINS = { roles: { none: { role: { in: ['admin', 'super_admin'] } } } };

describe('AdminService.listUsers', () => {
  it('leaves admins out of the list', async () => {
    const { service, asked } = setup();
    await service.listUsers({ page: 1, limit: 20 } as never);
    expect(asked[0].AND).toEqual([NO_ADMINS]);
  });

  it('keeps them out when filtering by a role too', async () => {
    const { service, asked } = setup();
    await service.listUsers({ page: 1, limit: 20, role: 'driver' } as never);
    expect(asked[0].AND).toEqual([NO_ADMINS, { roles: { some: { role: 'driver' } } }]);
  });
});
