import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Tells admins about a vehicle customers keep reporting (the AC did not
// work on an AC ride), so they can check it and take the tier away.
@Injectable()
export class VehicleAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VehicleAlertsService.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: DomainEvents,
    private readonly prisma: PrismaService,
    private readonly notifications: AdminNotificationsService,
  ) {}

  onModuleInit() {
    this.subscription = this.events
      .on<{ vehicleId: string; reports: number }>('vehicle.ac_reported')
      .subscribe(({ payload }) => {
        void this.acReported(payload.vehicleId, payload.reports).catch((e) =>
          this.logger.warn(`AC alert failed: ${String(e)}`),
        );
      });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private async acReported(vehicleId: string, reports: number) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        driverProfile: { include: { user: { select: { name: true } } } },
      },
    });
    if (!vehicle) return;
    await this.notifications.create({
      type: 'vehicle.ac_reported',
      title: 'AC complaints',
      body: `${reports} customers in 30 days said the AC did not work in ${vehicle.make} ${vehicle.model} (${vehicle.plateNumber}), driven by ${vehicle.driverProfile.user.name ?? 'a driver'}.`,
      targetType: 'vehicle',
      targetId: vehicleId,
    });
  }
}
