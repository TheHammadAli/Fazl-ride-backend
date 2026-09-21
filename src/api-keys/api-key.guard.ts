import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from './api-keys.service.js';
import { hasScope, SCOPES_KEY } from './scopes.js';

export interface ApiKeyPrincipal {
  id: string;
  name: string;
  scopes: string[];
}

// For routes meant for external systems: `x-api-key: <key>` plus the scopes
// listed with @Scopes(...). This is separate from the user JWT path.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const raw = request.headers['x-api-key'];
    if (typeof raw !== 'string' || !raw) {
      throw new UnauthorizedException('Missing API key');
    }
    const key = await this.keys.validate(raw);
    if (!key) throw new UnauthorizedException('Invalid API key');

    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.every((s) => hasScope(key.scopes, s))) {
      throw new ForbiddenException('API key does not have the required scope');
    }
    const principal: ApiKeyPrincipal = {
      id: key.id,
      name: key.name,
      scopes: key.scopes,
    };
    request.apiKey = principal;
    return true;
  }
}
