import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import {
  ListSafetyAlertsDto,
  RaiseSosDto,
  ResolveSafetyAlertDto,
  SosLocationDto,
} from './dto/safety.dto.js';
import { SafetyService } from './safety.service.js';

// Passengers and drivers: raise an SOS, keep its location fresh, close it.
@ApiTags('safety')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('safety/sos')
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post()
  raise(@CurrentUser() user: AuthUser, @Body() dto: RaiseSosDto) {
    return this.safety.raise(user.id, dto);
  }

  // Must stay above ':id'.
  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.safety.active(user.id);
  }

  @Post(':id/location')
  @HttpCode(200)
  location(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SosLocationDto,
  ) {
    return this.safety.updateLocation(user.id, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.safety.cancel(user.id, id);
  }
}

// Support: see, take and close SOS alerts.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/safety-alerts')
export class AdminSafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get()
  list(@Query() query: ListSafetyAlertsDto) {
    return this.safety.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.safety.get(id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.safety.acknowledge(user.id, id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveSafetyAlertDto,
  ) {
    return this.safety.resolve(user.id, id, dto.resolution);
  }
}
