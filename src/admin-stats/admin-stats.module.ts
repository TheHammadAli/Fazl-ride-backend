import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminStatsService } from './admin-stats.service.js';

// Read-only reporting for the admin panel (dashboard, live map, reports).
@Module({
  imports: [AuthModule],
  controllers: [AdminStatsController],
  providers: [AdminStatsService],
})
export class AdminStatsModule {}
