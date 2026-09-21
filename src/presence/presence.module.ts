import { Module } from '@nestjs/common';
import { CancellationsModule } from '../cancellations/cancellations.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DriverLocationStore } from './driver-location.store.js';
import { PostgisDriverLocationStore } from './postgis-driver-location.store.js';
import { PresenceController } from './presence.controller.js';
import { PresenceSweeperService } from './presence-sweeper.service.js';
import { PresenceService } from './presence.service.js';

@Module({
  imports: [AuthModule, CancellationsModule],
  controllers: [PresenceController],
  providers: [
    PresenceService,
    PresenceSweeperService,
    // Replace this binding to keep live locations in Redis instead.
    { provide: DriverLocationStore, useClass: PostgisDriverLocationStore },
  ],
  exports: [PresenceService, PresenceSweeperService, DriverLocationStore],
})
export class PresenceModule {}
