import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { VehicleCategoriesService } from './vehicle-categories.service.js';

// What a passenger can pick or a driver can register a vehicle as, right now.
// Any signed-in user - not just customers or drivers - the same as
// GET drivers/nearby.
@ApiTags('vehicle-categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicle-categories')
export class VehicleCategoriesController {
  constructor(private readonly categories: VehicleCategoriesService) {}

  @Get()
  list() {
    return this.categories.listActive();
  }
}
