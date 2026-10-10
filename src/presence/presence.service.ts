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
import { CancellationsService } from '../cancellations/cancellations.service.js';
import { findMissingProfile } from '../drivers/driver-requirements.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DestinationService } from './destination.service.js';
import { DriverLocationStore } from './driver-location.store.js';
import { GoOnlineDto, LocationUpdateDto } from './dto/presence.dto.js';
import { onlineSecondsSince } from './online-time.js';

@Injectable()
export class PresenceService {
  private readonly tzOffset: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: DriverLocationStore,
    private readonly events: DomainEvents,
    private readonly cancellations: CancellationsService,
    private readonly destination: DestinationService,
    config: ConfigService,
  ) {
    this.tzOffset = Number(
      config.get('BUSINESS_TZ_OFFSET_MINUTES') ?? DEFAULT_TZ_OFFSET_MINUTES,
    );
  }

  async goOnline(userId: string, dto: GoOnlineDto) {
    await this.cancellations.assertNotBlocked(userId, 'driver');
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        vehicles: {
          where: { status: 'approved' },
          orderBy: { createdAt: 'asc' },
        },
        user: { select: { name: true, avatarKey: true } },
      },
    });
    if (!profile || profile.status !== 'approved') {
      throw new ForbiddenException('Your driver account is not approved');
    }
    // Drivers approved before name/photo/dates became required, or whose
    // licence has since expired, finish their profile before driving.
    const missingProfile = findMissingProfile(profile.user, profile);
    if (missingProfile.length) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_INCOMPLETE',
        message: 'Complete your driver profile before going online',
        missingProfile,
      });
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
    this.events.emit('driver.location', {
      userId,
      lat: dto.lat,
      lng: dto.lng,
      busy: presence.busy,
    });
    await this.destination.checkArrival(userId, dto);
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
  onlineSecondsToday(userId: string, now = new Date()) {
    return this.onlineSecondsBetween(
      userId,
      startOfBusinessDay(now, this.tzOffset),
      now,
    );
  }

  // Online time inside [from, now]; used by the dashboard and the earnings periods.
  async onlineSecondsBetween(userId: string, from: Date, now = new Date()) {
    const sessions = await this.prisma.driverSession.findMany({
      where: { userId, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
    });
    return onlineSecondsSince(sessions, from, now);
  }
}
