import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { CancellationRole, RideStatus } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CancelRule, cooldownUntil } from './cancellation-policy.js';

@Injectable()
export class CancellationsService {
  readonly rule: CancelRule;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.enabled = String(config.get('CANCEL_RULE') ?? 'on') !== 'off';
    this.rule = {
      limit: Number(config.get('CANCEL_LIMIT') ?? 3),
      windowMs: Number(config.get('CANCEL_WINDOW_MINUTES') ?? 60) * 60_000,
      cooldownMs: Number(config.get('CANCEL_COOLDOWN_MINUTES') ?? 30) * 60_000,
    };
  }

  // Only cancellations after the other person was already committed count: a
  // passenger dropping a request nobody accepted has wasted nobody's time.
  record(
    tx: Prisma.TransactionClient,
    input: {
      rideId: string;
      userId: string;
      role: CancellationRole;
      fromStatus: RideStatus;
      reason?: string;
    },
  ) {
    return tx.rideCancellation.create({ data: input });
  }

  async status(userId: string, role: CancellationRole, now = new Date()) {
    // A block can outlive the window, so look back window + cool-down.
    const since = new Date(
      now.getTime() - this.rule.windowMs - this.rule.cooldownMs,
    );
    const rows = await this.prisma.rideCancellation.findMany({
      where: { userId, role, forgivenAt: null, createdAt: { gt: since } },
      select: { createdAt: true },
    });
    const windowStart = now.getTime() - this.rule.windowMs;
    return {
      blockedUntil: this.enabled
        ? cooldownUntil(
            rows.map((r) => r.createdAt),
            now,
            this.rule,
          )
        : null,
      cancellationsInWindow: rows.filter(
        (r) => r.createdAt.getTime() > windowStart,
      ).length,
      limit: this.rule.limit,
      windowMinutes: this.rule.windowMs / 60_000,
      cooldownMinutes: this.rule.cooldownMs / 60_000,
    };
  }

  async assertNotBlocked(userId: string, role: CancellationRole) {
    const { blockedUntil } = await this.status(userId, role);
    if (!blockedUntil) return;
    throw new ForbiddenException({
      message:
        role === 'passenger'
          ? 'You cancelled too many rides in a short time. Please try again later'
          : 'You cancelled too many rides in a short time. You cannot take rides for a while',
      code: 'CANCELLATION_COOLDOWN',
      blockedUntil,
    });
  }

  async history(userId: string) {
    return this.prisma.rideCancellation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        rideId: true,
        role: true,
        fromStatus: true,
        reason: true,
        forgivenAt: true,
        createdAt: true,
      },
    });
  }

  // Admin: lifts the block by making the current cancellations stop counting.
  async forgive(userId: string, adminId: string) {
    const result = await this.prisma.rideCancellation.updateMany({
      where: { userId, forgivenAt: null },
      data: { forgivenAt: new Date() },
    });
    await this.audit.log(adminId, 'cancellations.reset', 'user', userId, {
      forgiven: result.count,
    });
    return { forgiven: result.count };
  }
}
