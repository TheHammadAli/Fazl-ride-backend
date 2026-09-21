import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriverLocationStore } from './driver-location.store.js';
import { PostgisDriverLocationStore } from './postgis-driver-location.store.js';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PresenceController],
  providers: [
    PresenceService,
    // Replace this binding to keep live locations in Redis instead.
    { provide: DriverLocationStore, useClass: PostgisDriverLocationStore },
  ],
  exports: [PresenceService, DriverLocationStore],
})
export class PresenceModule {}
