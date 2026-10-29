import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  phone: string;
  roles: Role[];
  /** A view-only Fazl Admin login (see AuthService.fazlAdminLogin). */
  readOnly?: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
