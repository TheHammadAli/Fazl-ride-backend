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
import { AdminService } from './admin.service.js';
import { ListDriversDto, ListUsersDto, RejectDto } from './dto/admin.dto.js';

// REST endpoints for FAZL's existing admin panel (no new admin UI is built).
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  listUsers(@Query() query: ListUsersDto) {
    return this.admin.listUsers(query);
  }

  @Get('drivers')
  listDrivers(@Query() query: ListDriversDto) {
    return this.admin.listDrivers(query);
  }

  @Get('drivers/:id')
  getDriver(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getDriver(id);
  }

  @Post('drivers/:id/approve')
  @HttpCode(200)
  approveDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.approveDriver(id, user.id);
  }

  @Post('drivers/:id/reject')
  @HttpCode(200)
  rejectDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RejectDto,
  ) {
    return this.admin.rejectDriver(id, user.id, dto.reason);
  }

  @Post('vehicles/:id/approve')
  @HttpCode(200)
  approveVehicle(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setVehicleStatus(id, 'approved');
  }

  @Post('vehicles/:id/reject')
  @HttpCode(200)
  rejectVehicle(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setVehicleStatus(id, 'rejected');
  }
}
