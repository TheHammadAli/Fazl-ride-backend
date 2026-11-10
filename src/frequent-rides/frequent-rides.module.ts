import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import {
  AdminFrequentRidesController,
  FrequentRidesController,
} from './frequent-rides.controller.js';
import { FrequentRidesService } from './frequent-rides.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FrequentRidesController, AdminFrequentRidesController],
  providers: [FrequentRidesService],
})
export class FrequentRidesModule {}
