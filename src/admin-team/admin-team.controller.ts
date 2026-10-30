import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  AddTeamMemberDto,
  ChangeOwnPasswordDto,
  ChangeTeamRoleDto,
} from './admin-team.dto.js';
import { AdminTeamService } from './admin-team.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.super_admin)
@Controller('admin/team')
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get()
  list() {
    return this.team.list();
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Body() dto: AddTeamMemberDto) {
    return this.team.add(user.id, dto);
  }

  @Patch(':id')
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTeamRoleDto,
  ) {
    return this.team.changeRole(user.id, id, dto.role);
  }

  @Post(':id/reset-password')
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.team.resetPassword(user.id, id);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.team.remove(user.id, id);
  }
}

// Any admin's own panel password.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/me')
export class AdminMeController {
  constructor(private readonly team: AdminTeamService) {}

  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeOwnPasswordDto,
  ) {
    return this.team.changeOwnPassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
