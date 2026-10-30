import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { ListBroadcastsDto, SendBroadcastDto } from './broadcasts.dto.js';
import { BroadcastsService } from './broadcasts.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  // Each group with how many people and phones it reaches.
  @Get('audiences')
  audiences() {
    return this.broadcasts.audiences();
  }

  @Get()
  list(@Query() query: ListBroadcastsDto) {
    return this.broadcasts.list(query.page, query.limit);
  }

  @Post()
  send(@CurrentUser() user: AuthUser, @Body() dto: SendBroadcastDto) {
    return this.broadcasts.send(user.id, dto);
  }
}
