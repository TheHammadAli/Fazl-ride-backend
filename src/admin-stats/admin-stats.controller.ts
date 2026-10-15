import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { AdminStatsService } from './admin-stats.service.js';
import { DashboardQueryDto, ReportsQueryDto } from './admin-stats.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin')
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  // Numbers for the period, what is waiting for an admin, and the live map.
  @Get('dashboard')
  dashboard(@Query() q: DashboardQueryDto) {
    return this.stats.dashboard(q.period ?? 'today');
  }

  // Rides under way and online drivers right now (refreshed by the panel).
  @Get('live')
  live() {
    return this.stats.live();
  }

  // Day by day totals, by vehicle type, cancellations and payment split.
  @Get('reports')
  reports(@Query() q: ReportsQueryDto) {
    return this.stats.reports(q.from, q.to);
  }
}
