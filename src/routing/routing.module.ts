import { Global, Module } from '@nestjs/common';
import { HaversineRoutingProvider } from './haversine-routing.provider.js';
import { RoutingProvider } from './routing.provider.js';

// Distance and travel-time estimates for every module (rides, order tracking, ...).
// Replace the binding below to switch to Google Directions or another router.
@Global()
@Module({
  providers: [{ provide: RoutingProvider, useClass: HaversineRoutingProvider }],
  exports: [RoutingProvider],
})
export class RoutingModule {}
