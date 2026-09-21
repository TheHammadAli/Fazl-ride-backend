import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule, DriversModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
