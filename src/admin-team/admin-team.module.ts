import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminMeController,
  AdminTeamController,
} from './admin-team.controller.js';
import { AdminTeamService } from './admin-team.service.js';

// Web admin panel accounts (Settings > Admin team).
@Module({
  imports: [AuthModule],
  controllers: [AdminTeamController, AdminMeController],
  providers: [AdminTeamService],
})
export class AdminTeamModule {}
