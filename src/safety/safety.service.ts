import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  RideStatus,
  SafetyAlertStatus,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmergencyContactNotifier } from './emergency-contact-notifier.js';
import type { ListSafetyAlertsDto } from './dto/safety.dto.js';

// Still needs someone: the person has not said they are safe and support has
// not closed it.
const LIVE: SafetyAlertStatus[] = ['open', 'acknowledged'];

// A ride someone can be in trouble on: a driver is on the way or driving.
const UNDER_WAY: RideStatus[] = ['accepted', 'arrived', 'started'];

const person = { select: { id: true, name: true, phone: true } } as const;

@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: AdminNotificationsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly contactNotifier: EmergencyContactNotifier,
  ) {}

  // SOS. Pressing it again while an alert is still live just moves that
  // alert's location (no second alarm for support).
  async raise(
    userId: string,
    input: { rideId?: string; lat: number; lng: number },
  ) {
    const live = await this.prisma.safetyAlert.findFirst({
      where: { userId, status: { in: LIVE } },
      orderBy: { createdAt: 'desc' },
    });
    if (live) {
      await this.prisma.safetyAlert.update({
        where: { id: live.id },
        data: { lat: input.lat, lng: input.lng, locationAt: new Date() },
      });
      return this.mine(userId, live.id);
    }

    const ride = await this.rideFor(userId, input.rideId);
    const role = ride?.driverId === userId ? 'driver' : 'passenger';
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true,
        phone: true,
        emergencyContact: true,
        driverProfile: { select: { emergencyContact: true } },
      },
    });
    const alert = await this.prisma.safetyAlert.create({
      data: {
        userId,
        role,
        rideId: ride?.id,
        lat: input.lat,
        lng: input.lng,
      },
    });

    const who = user.name ?? user.phone;
    await this.notifications.create({
      type: 'sos',
      title: `SOS: ${who} needs help`,
      body: ride
        ? `${role === 'driver' ? 'Driver' : 'Passenger'} on a ride. Call them now and watch their location.`
        : 'Not on a ride. Call them now and watch their location.',
      targetType: 'safety_alert',
      targetId: alert.id,
    });
    await this.audit.log(userId, 'safety.sos', 'safety_alert', alert.id, {
      rideId: ride?.id ?? null,
      role,
    });
    this.events.emit('safety.sos', { alertId: alert.id, userId, role });

    const contact =
      user.emergencyContact ?? user.driverProfile?.emergencyContact ?? null;
    if (contact && this.contactNotifier.enabled) {
      this.contactNotifier
        .notify({
          contactPhone: contact,
          personName: user.name,
          lat: input.lat,
          lng: input.lng,
        })
        .catch((error) =>
          this.logger.warn(`Could not message the contact: ${String(error)}`),
        );
    }
    return this.mine(userId, alert.id);
  }

  // The live alert's location while the SOS screen is open.
  async updateLocation(
    userId: string,
    id: string,
    point: { lat: number; lng: number },
  ) {
    const { count } = await this.prisma.safetyAlert.updateMany({
      where: { id, userId, status: { in: LIVE } },
      data: { lat: point.lat, lng: point.lng, locationAt: new Date() },
    });
    if (!count) await this.assertMine(userId, id, 'no longer active');
    // Carries the status too, so the app sees support take it.
    return this.mine(userId, id);
  }

  // "I'm safe now": the person closes it themselves. Support still sees it,
  // marked as cancelled by them.
  async cancel(userId: string, id: string) {
    const { count } = await this.prisma.safetyAlert.updateMany({
      where: { id, userId, status: { in: LIVE } },
      data: { status: 'cancelled', resolvedAt: new Date() },
    });
    if (!count) await this.assertMine(userId, id, 'already closed');
    await this.audit.log(userId, 'safety.cancel', 'safety_alert', id);
    await this.notifications.create({
      type: 'sos_cancelled',
      title: 'SOS closed: they say they are safe',
      body: 'The person closed their SOS from the app.',
      targetType: 'safety_alert',
      targetId: id,
    });
    return this.mine(userId, id);
  }

  // The caller's live alert, if any (the app reopens it after a restart).
  async active(userId: string) {
    const alert = await this.prisma.safetyAlert.findFirst({
      where: { userId, status: { in: LIVE } },
      orderBy: { createdAt: 'desc' },
    });
    return { alert: alert ? this.view(alert) : null };
  }

  async mine(userId: string, id: string) {
    const alert = await this.prisma.safetyAlert.findFirst({
      where: { id, userId },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return {
      alert: this.view(alert),
      // So the app says only what really happened.
      contactMessaged: this.contactNotifier.enabled,
    };
  }

  // ---------------------------------------------------------------- admin

  async list(q: ListSafetyAlertsDto) {
    const where: Prisma.SafetyAlertWhereInput = q.status
      ? { status: q.status }
      : q.active === 'true'
        ? { status: { in: LIVE } }
        : {};
    const [items, total, counts] = await Promise.all([
      this.prisma.safetyAlert.findMany({
        where,
        // Live ones first, newest first within.
        orderBy: [{ createdAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: this.detailInclude,
      }),
      this.prisma.safetyAlert.count({ where }),
      this.prisma.safetyAlert.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      items: items.map((a) => this.adminView(a)),
      total,
      page: q.page,
      limit: q.limit,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  async get(id: string) {
    const alert = await this.prisma.safetyAlert.findUnique({
      where: { id },
      include: this.detailInclude,
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return this.adminView(alert);
  }

  async acknowledge(adminId: string, id: string) {
    const { count } = await this.prisma.safetyAlert.updateMany({
      where: { id, status: 'open' },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedById: adminId,
      },
    });
    if (!count) await this.assertExists(id, 'is not waiting any more');
    await this.audit.log(adminId, 'safety.acknowledge', 'safety_alert', id);
    const { userId } = await this.prisma.safetyAlert.findUniqueOrThrow({
      where: { id },
      select: { userId: true },
    });
    this.events.emit('safety.acknowledged', { alertId: id, userId });
    return this.get(id);
  }

  async resolve(adminId: string, id: string, resolution: string) {
    const { count } = await this.prisma.safetyAlert.updateMany({
      where: { id, status: { in: LIVE } },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedById: adminId,
        resolution,
      },
    });
    if (!count) await this.assertExists(id, 'is already closed');
    await this.audit.log(adminId, 'safety.resolve', 'safety_alert', id, {
      resolution,
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- helpers

  // The ride the SOS is about: the one given (must be the caller's), else the
  // caller's ride under way as passenger or driver.
  private async rideFor(userId: string, rideId?: string) {
    const mine = {
      OR: [{ passengerId: userId }, { driverId: userId }],
    };
    if (rideId) {
      const ride = await this.prisma.ride.findFirst({
        where: { id: rideId, ...mine },
        select: { id: true, driverId: true },
      });
      if (!ride) throw new ForbiddenException('Not your ride');
      return ride;
    }
    return this.prisma.ride.findFirst({
      where: { ...mine, status: { in: UNDER_WAY } },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, driverId: true },
    });
  }

  private async assertMine(userId: string, id: string, why: string) {
    const exists = await this.prisma.safetyAlert.count({
      where: { id, userId },
    });
    if (!exists) throw new NotFoundException('Alert not found');
    throw new ConflictException(`This alert is ${why}`);
  }

  private async assertExists(id: string, why: string) {
    const exists = await this.prisma.safetyAlert.count({ where: { id } });
    if (!exists) throw new NotFoundException('Alert not found');
    throw new ConflictException(`This alert ${why}`);
  }

  private view(a: {
    id: string;
    status: SafetyAlertStatus;
    role: string;
    rideId: string | null;
    lat: number;
    lng: number;
    locationAt: Date;
    acknowledgedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: a.id,
      status: a.status,
      role: a.role,
      rideId: a.rideId,
      location: { lat: a.lat, lng: a.lng, at: a.locationAt },
      acknowledgedAt: a.acknowledgedAt,
      createdAt: a.createdAt,
    };
  }

  private readonly detailInclude = {
    user: {
      select: {
        id: true,
        name: true,
        phone: true,
        emergencyContact: true,
        driverProfile: { select: { emergencyContact: true } },
      },
    },
    ride: {
      select: {
        id: true,
        status: true,
        category: true,
        pickupAddress: true,
        dropoffAddress: true,
        passenger: person,
        driver: person,
        vehicle: {
          select: { make: true, model: true, color: true, plateNumber: true },
        },
      },
    },
  } satisfies Prisma.SafetyAlertInclude;

  private adminView(
    a: Prisma.SafetyAlertGetPayload<{
      include: SafetyService['detailInclude'];
    }>,
  ) {
    return {
      ...this.view(a),
      resolvedAt: a.resolvedAt,
      resolution: a.resolution,
      user: {
        id: a.user.id,
        name: a.user.name,
        phone: a.user.phone,
        emergencyContact:
          a.user.emergencyContact ??
          a.user.driverProfile?.emergencyContact ??
          null,
      },
      ride: a.ride,
    };
  }
}
