import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { AdminFaresController } from './admin-fares.controller.js';
import { FaresService } from './fares.service.js';
import { HaversineRoutingProvider } from './routing/haversine-routing.provider.js';
import { RoutingProvider } from './routing/routing.provider.js';
import { RidesController } from './rides.controller.js';

@Module({
  imports: [AuthModule, PresenceModule],
  controllers: [RidesController, AdminFaresController],
  providers: [
    FaresService,
    // Replace this binding to switch to Google Directions or another router.
    { provide: RoutingProvider, useClass: HaversineRoutingProvider },
  ],
  exports: [FaresService, RoutingProvider],
})
export class RidesModule {}
