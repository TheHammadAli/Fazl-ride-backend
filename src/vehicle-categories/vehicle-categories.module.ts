import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminVehicleCategoriesController } from './admin-vehicle-categories.controller.js';
import { VehicleCategoriesController } from './vehicle-categories.controller.js';
import { VehicleCategoriesService } from './vehicle-categories.service.js';

// A standalone module (no dependency on rides/drivers/presence) so each of
// them can depend on it without any risk of a module import cycle.
@Module({
  imports: [AuthModule],
  controllers: [VehicleCategoriesController, AdminVehicleCategoriesController],
  providers: [VehicleCategoriesService],
  exports: [VehicleCategoriesService],
})
export class VehicleCategoriesModule {}
