import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ApplyDriverDto, VehicleDto } from './dto/driver.dto.js';
import { DriversService } from './drivers.service.js';

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Post('apply')
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyDriverDto) {
    return this.drivers.apply(user.id, dto);
  }

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.drivers.getMine(user.id);
  }

  @Post('me/vehicles')
  addVehicle(@CurrentUser() user: AuthUser, @Body() dto: VehicleDto) {
    return this.drivers.addVehicle(user.id, dto);
  }
}
