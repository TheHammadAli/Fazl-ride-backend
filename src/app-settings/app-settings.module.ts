import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminAppSettingsController,
  ConfigController,
} from './app-settings.controller.js';
import { AppSettingsService } from './app-settings.service.js';

// Settings the apps read and admins edit (support contacts, legal links).
@Module({
  imports: [AuthModule],
  controllers: [ConfigController, AdminAppSettingsController],
  providers: [AppSettingsService],
})
export class AppSettingsModule {}
