import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { RealtimeAuthService } from './realtime-auth.service.js';
import { RealtimeEventsService } from './realtime-events.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

// Depends on rides and presence, never the other way round: they only announce
// domain events, so realtime can be removed or replaced without touching them.
@Module({
  imports: [AuthModule, PresenceModule, RidesModule, WalletModule],
  providers: [RealtimeGateway, RealtimeAuthService, RealtimeEventsService],
})
export class RealtimeModule {}
