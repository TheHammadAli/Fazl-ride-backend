import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';
import { FcmPushProvider } from './fcm-push.provider.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { PushProvider } from './push.provider.js';

// Push notifications for phones whose app is closed. Listens to domain
// events only, so no other module knows it exists.
@Module({
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    PushNotificationsService,
    // Replace this binding to send through another service.
    { provide: PushProvider, useClass: FcmPushProvider },
  ],
  exports: [DevicesService],
})
export class PushModule {}
