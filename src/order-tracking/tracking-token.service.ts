import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const TOUCH_EVERY_MS = 60_000;

// A tracking token opens exactly one order, without an account. Only its hash is
// stored, so a copy of the database cannot be used to watch anyone's order.
@Injectable()
export class TrackingTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(orderId: string, ttlMs: number) {
    const token = `trk_${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.trackingToken.create({
      data: { orderId, tokenHash: this.hash(token), expiresAt },
    });
    return { token, expiresAt };
  }

  // Returns which order the token opens, or null if it is unknown, expired or revoked.
  async resolve(raw: string) {
    const record = await this.prisma.trackingToken.findUnique({
      where: { tokenHash: this.hash(raw) },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date())
      return null;
    if (
      !record.lastUsedAt ||
      Date.now() - record.lastUsedAt.getTime() > TOUCH_EVERY_MS
    ) {
      void this.prisma.trackingToken
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return { orderId: record.orderId, expiresAt: record.expiresAt };
  }

  async revokeAll(orderId: string) {
    const result = await this.prisma.trackingToken.updateMany({
      where: { orderId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
