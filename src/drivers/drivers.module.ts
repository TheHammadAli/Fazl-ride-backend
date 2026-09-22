import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DriverApprovalService } from './driver-approval.service.js';
import { DriverRequirementsService } from './driver-requirements.js';
import { DriverDocumentsService } from './driver-documents.service.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [DriversController],
  providers: [
    DriversService,
    DriverDocumentsService,
    DriverRequirementsService,
    DriverApprovalService,
  ],
  exports: [
    DriverDocumentsService,
    DriverRequirementsService,
    DriverApprovalService,
  ],
})
export class DriversModule {}
