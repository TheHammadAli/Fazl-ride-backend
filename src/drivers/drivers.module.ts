import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
