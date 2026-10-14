import { VehicleAlertsService } from './vehicle-alerts.service.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { VehicleCategoriesModule } from '../vehicle-categories/vehicle-categories.module.js';
import { DriverApprovalService } from './driver-approval.service.js';
import { DriverIdentityService } from './driver-identity.service.js';
import { DriverRequirementsService } from './driver-requirements.js';
import { DriverDocumentsService } from './driver-documents.service.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    VehicleCategoriesModule,
    PresenceModule,
    AdminNotificationsModule,
  ],
  controllers: [DriversController],
  providers: [
    DriversService,
    DriverDocumentsService,
    DriverRequirementsService,
    DriverApprovalService,
    DriverIdentityService,
    VehicleAlertsService,
  ],
  exports: [
    DriverDocumentsService,
    DriverRequirementsService,
    DriverApprovalService,
    DriverIdentityService,
  ],
})
export class DriversModule {}
