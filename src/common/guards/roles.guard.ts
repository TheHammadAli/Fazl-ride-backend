import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/enums.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Use after JwtAuthGuard. Passes if the user holds at least one required role.
// A view-only Fazl Admin login passes for reading only.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser; method: string }>();
    const user = request.user;
    if (!required.some((role) => user?.roles?.includes(role))) return false;
    if (user?.readOnly && !READ_METHODS.has(request.method)) {
      throw new ForbiddenException(
        'Your Fazl Ride access is view only. Ask a super admin for edit access.',
      );
    }
    return true;
  }
}
