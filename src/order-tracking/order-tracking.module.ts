import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminOrdersController } from './admin-orders.controller.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { IntegrationOrdersController } from './integration-orders.controller.js';
import { OrderActivityProvider } from './order-activity.provider.js';
import { OrderStatusService } from './order-status.service.js';
import { OrdersService } from './orders.service.js';
import { TrackingController } from './tracking.controller.js';
import { TrackingGateway } from './tracking.gateway.js';
import { TrackingTokenService } from './tracking-token.service.js';

// Follows orders placed in another system (FAZL APP). Self-contained: it depends
// only on shared pieces (database, events, routing, API keys) and no other feature module.
@Module({
  imports: [AuthModule, ApiKeysModule],
  controllers: [
    IntegrationOrdersController,
    TrackingController,
    AdminOrdersController,
  ],
  providers: [
    OrdersService,
    OrderStatusService,
    TrackingTokenService,
    AdminOrdersService,
    OrderActivityProvider,
    TrackingGateway,
  ],
})
export class OrderTrackingModule {}
