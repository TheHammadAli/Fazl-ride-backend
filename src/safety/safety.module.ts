import { Module } from '@nestjs/common';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  EmergencyContactNotifier,
  LoggingEmergencyContactNotifier,
} from './emergency-contact-notifier.js';
import {
  AdminSafetyController,
  AdminSafetyTeamController,
  SafetyController,
} from './safety.controller.js';
import { SafetySweeperService } from './safety-sweeper.service.js';
import { SafetyService } from './safety.service.js';

@Module({
  imports: [AuthModule, AdminNotificationsModule],
  controllers: [
    SafetyController,
    AdminSafetyController,
    AdminSafetyTeamController,
  ],
  providers: [
    SafetyService,
    SafetySweeperService,
    // Swap for an SMS adapter once a provider is chosen.
    {
      provide: EmergencyContactNotifier,
      useClass: LoggingEmergencyContactNotifier,
    },
  ],
})
export class SafetyModule {}
