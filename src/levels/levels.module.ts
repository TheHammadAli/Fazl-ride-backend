import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import {
  AdminDriverLevelsController,
  DriverLevelController,
} from './levels.controller.js';
import { LevelsService } from './levels.service.js';

// Driver achievement levels (Silver, Gold, Platinum) and their rewards.
@Module({
  imports: [AuthModule, WalletModule],
  controllers: [DriverLevelController, AdminDriverLevelsController],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class LevelsModule {}
