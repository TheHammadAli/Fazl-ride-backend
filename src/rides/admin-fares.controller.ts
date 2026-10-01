import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role, TripType } from '../generated/prisma/enums.js';
import { UpdateFareConfigDto } from './dto/fare-config.dto.js';
import { FaresService } from './fares.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/fares')
export class AdminFaresController {
  constructor(private readonly fares: FaresService) {}

  // ?tripType=within_city|city_to_city narrows the list; left out, every
  // rate card (both trip types, every category) comes back.
  @Get()
  list(
    @Query('tripType', new ParseEnumPipe(TripType, { optional: true }))
    tripType?: TripType,
  ) {
    return this.fares.listConfigs(tripType);
  }

  // `category` is no longer a fixed enum (see admin/vehicle-categories), so
  // an unknown key here just 404s from updateConfig() instead of being
  // rejected up front by a pipe. tripType is a real fixed enum (two trip
  // types, not admin-managed), so it is validated here.
  @Put(':category/:tripType')
  update(
    @Param('category') category: string,
    @Param('tripType', new ParseEnumPipe(TripType)) tripType: TripType,
    @Body() dto: UpdateFareConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fares.updateConfig(category, tripType, dto, user.id);
  }
}
