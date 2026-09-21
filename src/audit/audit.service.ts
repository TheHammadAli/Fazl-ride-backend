import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Records who did what. `actorId` is null for actions done by an API key.
  log(
    actorId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    meta?: Prisma.InputJsonValue,
  ) {
    return this.prisma.auditLog.create({
      data: { actorId, action, targetType, targetId, meta },
    });
  }
}
