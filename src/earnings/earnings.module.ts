import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { EarningsController } from './earnings.controller.js';
import { EarningsService } from './earnings.service.js';

@Module({
  imports: [AuthModule, PresenceModule],
  controllers: [EarningsController],
  providers: [EarningsService],
  exports: [EarningsService],
})
export class EarningsModule {}
