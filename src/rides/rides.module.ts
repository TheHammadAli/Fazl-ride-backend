import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CancellationsModule } from '../cancellations/cancellations.module.js';
import { EarningsModule } from '../earnings/earnings.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { AdminRidesController } from './admin-rides.controller.js';
import { AdminRidesService } from './admin-rides.service.js';
import { AdminFaresController } from './admin-fares.controller.js';
import { FaresService } from './fares.service.js';
import { HaversineRoutingProvider } from './routing/haversine-routing.provider.js';
import { RoutingProvider } from './routing/routing.provider.js';
import { DriverRidesController, RidesController } from './rides.controller.js';
import { MatchingService } from './matching.service.js';
import { RideActivityProvider } from './ride-activity.provider.js';
import { RatingsService } from './ratings.service.js';
import { TripTrackerService } from './trip-tracker.service.js';
import { RideSettings } from './rides.settings.js';
import { RidesService } from './rides.service.js';

@Module({
  imports: [AuthModule, PresenceModule, CancellationsModule, EarningsModule],
  controllers: [
    RidesController,
    DriverRidesController,
    AdminFaresController,
    AdminRidesController,
  ],
  providers: [
    FaresService,
    RidesService,
    MatchingService,
    TripTrackerService,
    RatingsService,
    AdminRidesService,
    RideActivityProvider,
    RideSettings,
    // Replace this binding to switch to Google Directions or another router.
    { provide: RoutingProvider, useClass: HaversineRoutingProvider },
  ],
  exports: [FaresService, RidesService, MatchingService, RoutingProvider],
})
export class RidesModule {}
