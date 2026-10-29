import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../decorators/current-user.decorator.js';
import { RolesGuard } from './roles.guard.js';

// An admin route (@Roles admin / super_admin) called with [method] by [user].
function check(method: string, user: Partial<AuthUser>) {
  const reflector = {
    getAllAndOverride: () => ['admin', 'super_admin'],
  } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  };
  return () => new RolesGuard(reflector).canActivate(context as never);
}

describe('RolesGuard', () => {
  it('lets an admin read and change', () => {
    expect(check('GET', { roles: ['admin'] })()).toBe(true);
    expect(check('POST', { roles: ['admin'] })()).toBe(true);
  });

  it('keeps out someone without the role', () => {
    expect(check('GET', { roles: ['customer'] })()).toBe(false);
  });

  it('lets a view-only Fazl Admin login read, never change', () => {
    const viewer = { roles: ['admin' as const], readOnly: true };
    expect(check('GET', viewer)()).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(check(method, viewer)).toThrow(ForbiddenException);
    }
  });
});
