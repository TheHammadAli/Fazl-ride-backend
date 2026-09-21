import { SetMetadata } from '@nestjs/common';

// A scope is `<resource>:<read|write|*>`, e.g. `parking:write`, `orders:read`.
// `parking:*` grants every action on a resource and `*` grants everything.
// Modules pick their own resource names; nothing has to be registered here.
export const SCOPE_PATTERN = /^([a-z][a-z_]*:(read|write|\*)|\*)$/;

export const SCOPES_KEY = 'api_scopes';
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

export function hasScope(granted: string[], required: string): boolean {
  const [resource] = required.split(':');
  return (
    granted.includes('*') ||
    granted.includes(required) ||
    granted.includes(`${resource}:*`)
  );
}
