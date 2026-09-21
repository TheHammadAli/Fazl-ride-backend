import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role, VehicleCategory } from '../generated/prisma/enums.js';
import { UpdateFareConfigDto } from './dto/fare-config.dto.js';
import { FaresService } from './fares.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/fares')
export class AdminFaresController {
  constructor(private readonly fares: FaresService) {}

  @Get()
  list() {
    return this.fares.listConfigs();
  }

  @Put(':category')
  update(
    @Param('category', new ParseEnumPipe(VehicleCategory))
    category: VehicleCategory,
    @Body() dto: UpdateFareConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fares.updateConfig(category, dto, user.id);
  }
}
