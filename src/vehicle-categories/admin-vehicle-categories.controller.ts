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
  CreateVehicleCategoryDto,
  UpdateVehicleCategoryDto,
} from './dto/vehicle-category.dto.js';
import { VehicleCategoriesService } from './vehicle-categories.service.js';
import { VehicleTiersService } from './vehicle-tiers.service.js';

// Lets an admin add a new vehicle type (e.g. "rickshaw") - and edit or
// deactivate an existing one - without a code deploy. See
// docs/VEHICLE_CATEGORIES.md.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/vehicle-categories')
export class AdminVehicleCategoriesController {
  constructor(
    private readonly categories: VehicleCategoriesService,
    private readonly tiers: VehicleTiersService,
  ) {}

  @Get()
  list() {
    return this.categories.listAll();
  }

  // Creates the category and its starting fare row together - a category
  // with no fare_configs row could never actually be booked.
  @Post()
  async create(
    @Body() dto: CreateVehicleCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const created = await this.categories.create(dto, user.id);
    // A new open tier reaches drivers already online.
    await this.tiers.refreshOnline({ base: created.parentKey ?? created.key });
    return created;
  }

  // Categories are never deleted (rides/vehicles may already reference one) -
  // set `active: false` to retire it instead.
  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateVehicleCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const updated = await this.categories.update(key, dto, user.id);
    await this.tiers.refreshOnline({ base: updated.parentKey ?? updated.key });
    return updated;
  }
}
