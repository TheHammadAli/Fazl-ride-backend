import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
  CreateServiceCityDto,
  ServiceAreaRuleDto,
  UpdateServiceCityDto,
} from './service-areas.dto.js';
import { ServiceAreasService } from './service-areas.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/service-cities')
export class AdminServiceCitiesController {
  constructor(private readonly areas: ServiceAreasService) {}

  @Get()
  list() {
    return this.areas.list();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceCityDto) {
    return this.areas.create(user.id, dto);
  }

  // Whether rides may only start inside an active city.
  @Put('rule')
  rule(@CurrentUser() user: AuthUser, @Body() dto: ServiceAreaRuleDto) {
    return this.areas.setRule(user.id, dto.onlyServiceCities);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCityDto,
  ) {
    return this.areas.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.areas.remove(user.id, id);
  }
}
