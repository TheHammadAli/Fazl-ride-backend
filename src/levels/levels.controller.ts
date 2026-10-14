import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
  CreateDriverLevelDto,
  UpdateDriverLevelDto,
} from './dto/driver-level.dto.js';
import { LevelsService } from './levels.service.js';

@ApiTags('driver-levels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.driver)
@Controller('drivers/me/level')
export class DriverLevelController {
  constructor(private readonly levels: LevelsService) {}

  // Trips, level, progress to the next one, and every level's rewards.
  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.levels.summary(user.id);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/driver-levels')
export class AdminDriverLevelsController {
  constructor(private readonly levels: LevelsService) {}

  @Get()
  list() {
    return this.levels.listAll();
  }

  @Post()
  create(@Body() dto: CreateDriverLevelDto, @CurrentUser() user: AuthUser) {
    return this.levels.create(dto, user.id);
  }

  // Levels are not deleted (drivers may hold one): set active false.
  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateDriverLevelDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.levels.update(key, dto, user.id);
  }
}
