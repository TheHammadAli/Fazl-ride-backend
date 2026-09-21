import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  startOfBusinessDay,
  DEFAULT_TZ_OFFSET_MINUTES,
} from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DriverLocationStore } from './driver-location.store.js';
import { GoOnlineDto, LocationUpdateDto } from './dto/presence.dto.js';

@Injectable()
export class PresenceService {
  private readonly tzOffset: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: DriverLocationStore,
    config: ConfigService,
  ) {
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  async goOnline(userId: string, dto: GoOnlineDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        vehicles: {
          where: { status: 'approved' },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!profile || profile.status !== 'approved') {
      throw new ForbiddenException('Your driver account is not approved');
    }
    const vehicle = dto.vehicleId
      ? profile.vehicles.find((v) => v.id === dto.vehicleId)
      : profile.vehicles[0];
    if (!vehicle) {
      throw new NotFoundException(
        dto.vehicleId
          ? 'Approved vehicle not found'
          : 'You have no approved vehicle',
      );
    }

    await this.store.goOnline(userId, vehicle.id, vehicle.category, dto);
    const open = await this.prisma.driverSession.findFirst({
      where: { userId, endedAt: null },
    });
    if (!open) await this.prisma.driverSession.create({ data: { userId } });
    return this.status(userId);
  }

  async goOffline(userId: string) {
    const presence = await this.prisma.driverPresence.findUnique({
      where: { userId },
    });
    if (presence?.busy) {
      throw new ConflictException(
        'Finish your current ride before going offline',
      );
    }
    await this.store.goOffline(userId);
    await this.prisma.driverSession.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: new Date() },
    });
    return this.status(userId);
  }

  async updateLocation(userId: string, dto: LocationUpdateDto) {
    const presence = await this.prisma.driverPresence.findUnique({
      where: { userId },
    });
    if (!presence?.isOnline)
      throw new ConflictException('Go online before sending locations');
    await this.store.updateLocation(userId, dto, {
      heading: dto.heading,
      speedKmh: dto.speedKmh,
    });
    return { ok: true };
  }

  async status(userId: string) {
    const [presence, seconds] = await Promise.all([
      this.prisma.driverPresence.findUnique({ where: { userId } }),
      this.onlineSecondsToday(userId),
    ]);
    return {
      online: presence?.isOnline ?? false,
      busy: presence?.busy ?? false,
      vehicleId: presence?.isOnline ? presence.vehicleId : null,
      onlineSince: presence?.isOnline ? presence.onlineSince : null,
      onlineSecondsToday: seconds,
    };
  }

  // Online time inside today's business day, counting a still-open session up to now.
  async onlineSecondsToday(userId: string, now = new Date()) {
    const dayStart = startOfBusinessDay(now, this.tzOffset);
    const sessions = await this.prisma.driverSession.findMany({
      where: { userId, OR: [{ endedAt: null }, { endedAt: { gt: dayStart } }] },
    });
    const ms = sessions.reduce((sum, s) => {
      const from = Math.max(s.startedAt.getTime(), dayStart.getTime());
      const to = (s.endedAt ?? now).getTime();
      return sum + Math.max(0, to - from);
    }, 0);
    return Math.round(ms / 1000);
  }
}
