import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminCancellationsController,
  CancellationStatusController,
} from './cancellations.controller.js';
import { CancellationsService } from './cancellations.service.js';

// A leaf module: rides and presence both use it, and it uses neither.
@Module({
  imports: [AuthModule],
  controllers: [CancellationStatusController, AdminCancellationsController],
  providers: [CancellationsService],
  exports: [CancellationsService],
})
export class CancellationsModule {}
