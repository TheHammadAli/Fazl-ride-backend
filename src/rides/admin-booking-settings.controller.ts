import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { BookingSettingsService } from './booking-settings.service.js';
import { UpdateBookingSettingsDto } from './dto/booking-settings.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/booking-settings')
export class AdminBookingSettingsController {
  constructor(private readonly settings: BookingSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBookingSettingsDto) {
    return this.settings.update(user.id, dto);
  }
}
