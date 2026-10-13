import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CancellationsModule } from '../cancellations/cancellations.module.js';
import { EarningsModule } from '../earnings/earnings.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { VehicleCategoriesModule } from '../vehicle-categories/vehicle-categories.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { AdminRidesController } from './admin-rides.controller.js';
import { AdminRidesService } from './admin-rides.service.js';
import { AdminFaresController } from './admin-fares.controller.js';
import { FaresService } from './fares.service.js';
import { RoutingModule } from '../routing/routing.module.js';
import { DriverRidesController, RidesController } from './rides.controller.js';
import { MatchingService } from './matching.service.js';
import { RideActivityProvider } from './ride-activity.provider.js';
import { RatingsService } from './ratings.service.js';
import { TripTrackerService } from './trip-tracker.service.js';
import { RideSettings } from './rides.settings.js';
import { RidesService } from './rides.service.js';

import { FreightController } from './freight.controller.js';
import { AdminBookingSettingsController } from './admin-booking-settings.controller.js';
import { BookingSettingsService } from './booking-settings.service.js';
import { BookingSweeperService } from './booking-sweeper.service.js';
import { FreightService } from './freight.service.js';
import { ReservationsService } from './reservations.service.js';

@Module({
  imports: [
    AuthModule,
    PresenceModule,
    CancellationsModule,
    EarningsModule,
    RoutingModule,
    VehicleCategoriesModule,
    WalletModule,
  ],
  controllers: [
    AdminBookingSettingsController,
    RidesController,
    DriverRidesController,
    AdminFaresController,
    AdminRidesController,
    FreightController,
  ],
  providers: [
    BookingSettingsService,
    BookingSweeperService,
    FaresService,
    RidesService,
    MatchingService,
    TripTrackerService,
    RatingsService,
    AdminRidesService,
    RideActivityProvider,
    RideSettings,
    FreightService,
    ReservationsService,
  ],
  exports: [FaresService, RidesService, MatchingService],
})
export class RidesModule {}
