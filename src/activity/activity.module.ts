import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

// Global so any module can register its own source without importing anything else.
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
