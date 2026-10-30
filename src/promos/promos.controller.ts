import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import {
  CheckPromoDto,
  CreatePromoDto,
  ListPromosDto,
  UpdatePromoDto,
} from './promos.dto.js';
import { PromosService } from './promos.service.js';

@ApiTags('promos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('promos')
export class PromosController {
  constructor(private readonly promos: PromosService) {}

  // Few tries a minute, so codes cannot be guessed by trying many.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('check')
  check(@CurrentUser() user: AuthUser, @Body() dto: CheckPromoDto) {
    return this.promos.check(user.id, dto);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/promos')
export class AdminPromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list(@Query() query: ListPromosDto) {
    return this.promos.list(query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePromoDto) {
    return this.promos.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoDto,
  ) {
    return this.promos.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promos.remove(user.id, id);
  }
}
