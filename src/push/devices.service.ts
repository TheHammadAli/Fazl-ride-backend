import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushProvider, type PushMessage } from './push.provider.js';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushProvider,
  ) {}

  // A phone signed in: its token now belongs to this person (a shared phone
  // stops getting the previous person's notifications).
  async register(userId: string, token: string, platform: string) {
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { token, userId, platform },
      update: { userId, platform },
    });
    return { ok: true };
  }

  // Signing out: this phone gets nothing more for this person.
  async unregister(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { ok: true };
  }

  // Sends to every phone of these people. Never throws: a notification that
  // cannot go out must not break what caused it.
  async notify(userIds: string[], message: PushMessage) {
    try {
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true },
      });
      if (!devices.length) return;
      const { deadTokens } = await this.push.send(
        devices.map((d) => d.token),
        message,
      );
      if (deadTokens.length) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: deadTokens } },
        });
      }
    } catch (error) {
      this.logger.warn(`Could not send push: ${String(error)}`);
    }
  }
}
