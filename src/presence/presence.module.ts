import { Module } from '@nestjs/common';
import { CancellationsModule } from '../cancellations/cancellations.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { VehicleCategoriesModule } from '../vehicle-categories/vehicle-categories.module.js';
import { DestinationService } from './destination.service.js';
import { DriverLocationStore } from './driver-location.store.js';
import { PostgisDriverLocationStore } from './postgis-driver-location.store.js';
import { NearbyDriversController } from './nearby-drivers.controller.js';
import { PresenceController } from './presence.controller.js';
import { PresenceSweeperService } from './presence-sweeper.service.js';
import { PresenceService } from './presence.service.js';

@Module({
  imports: [
    AuthModule,
    CancellationsModule,
    WalletModule,
    VehicleCategoriesModule,
  ],
  controllers: [PresenceController, NearbyDriversController],
  providers: [
    PresenceService,
    PresenceSweeperService,
    DestinationService,
    // Replace this binding to keep live locations in Redis instead.
    { provide: DriverLocationStore, useClass: PostgisDriverLocationStore },
  ],
  exports: [
    PresenceService,
    PresenceSweeperService,
    DriverLocationStore,
    DestinationService,
  ],
})
export class PresenceModule {}
