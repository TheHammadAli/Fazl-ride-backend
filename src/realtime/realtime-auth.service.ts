import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Reads the access token from a Socket.IO handshake: `auth: { token }` (what the
// Flutter client should send) or a normal `Authorization: Bearer` header.
export function tokenFromHandshake(handshake: {
  auth?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): string | null {
  const fromAuth = handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth)
    return fromAuth.replace(/^Bearer\s+/i, '');
  const header = handshake.headers?.authorization;
  if (typeof header === 'string' && /^Bearer\s+\S+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '');
  }
  return null;
}

@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // Same rules as the REST guard: a valid token AND a user who is still active.
  async authenticate(
    token: string,
  ): Promise<{ user: AuthUser; expiresAtMs: number } | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; exp: number }>(
        token,
      );
      const user = await this.loadUser(payload.sub);
      return user ? { user, expiresAtMs: payload.exp * 1000 } : null;
    } catch {
      return null;
    }
  }

  // Roles are read fresh every time, so a suspension or block applies at once.
  async loadUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user || user.status !== 'active') return null;
    return {
      id: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
    };
  }
}
