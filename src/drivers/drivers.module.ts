import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriverDocumentsService } from './driver-documents.service.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DriversController],
  providers: [DriversService, DriverDocumentsService],
  exports: [DriverDocumentsService],
})
export class DriversModule {}
