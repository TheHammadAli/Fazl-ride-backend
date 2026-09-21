import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './activity/activity.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ApiKeysModule } from './api-keys/api-keys.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.validation.js';
import { CancellationsModule } from './cancellations/cancellations.module.js';
import { EarningsModule } from './earnings/earnings.module.js';
import { DomainEventsModule } from './events/domain-events.module.js';
import { DriversModule } from './drivers/drivers.module.js';
import { HealthController } from './health/health.controller.js';
import { OrderTrackingModule } from './order-tracking/order-tracking.module.js';
import { PresenceModule } from './presence/presence.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RoutingModule } from './routing/routing.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RidesModule } from './rides/rides.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Per signed-in session (or per IP before login). Generous on purpose: until
    // sockets arrive the apps poll, and a driver also streams locations.
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT ?? 300) },
    ]),
    PrismaModule,
    RoutingModule,
    StorageModule,
    AuditModule,
    DomainEventsModule,
    ActivityModule,
    CancellationsModule,
    EarningsModule,
    ApiKeysModule,
    AuthModule,
    UsersModule,
    DriversModule,
    PresenceModule,
    RidesModule,
    RealtimeModule,
    OrderTrackingModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}
