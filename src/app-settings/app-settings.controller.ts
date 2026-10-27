import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { UpdateAppSettingsDto } from './app-settings.dto.js';
import { AppSettingsService } from './app-settings.service.js';

// For the apps: support contacts and legal links, no login.
@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  get() {
    return this.settings.publicConfig();
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/app-settings')
export class AdminAppSettingsController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateAppSettingsDto) {
    return this.settings.update(user.id, dto);
  }
}
