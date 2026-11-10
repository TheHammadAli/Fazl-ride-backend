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
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import {
  BookFrequentRideDto,
  CreateFrequentRideRouteDto,
  ReviewFrequentRideApplicationDto,
  SearchFrequentRidesDto,
  UpdateFrequentRideRouteDto,
} from './dto/frequent-rides.dto.js';
import { FrequentRidesService } from './frequent-rides.service.js';

@ApiTags('frequent-rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('frequent-rides')
export class FrequentRidesController {
  constructor(private readonly frequent: FrequentRidesService) {}

  @Get('application')
  application(@CurrentUser() user: AuthUser) {
    return this.frequent.application(user.id);
  }

  @Post('application')
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  apply(@CurrentUser() user: AuthUser) {
    return this.frequent.apply(user.id);
  }

  @Get('routes/mine')
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  myRoutes(@CurrentUser() user: AuthUser) {
    return this.frequent.myRoutes(user.id);
  }

  @Post('routes')
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  createRoute(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFrequentRideRouteDto,
  ) {
    return this.frequent.createRoute(user.id, dto);
  }

  @Patch('routes/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  updateRoute(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFrequentRideRouteDto,
  ) {
    return this.frequent.updateRoute(user.id, id, dto);
  }

  @Get('search')
  search(@Query() dto: SearchFrequentRidesDto) {
    return this.frequent.search(dto);
  }

  @Get('bookings/mine')
  bookings(@CurrentUser() user: AuthUser, @Query('as') side?: string) {
    return this.frequent.bookings(
      user.id,
      side === 'driver' ? 'driver' : 'passenger',
    );
  }

  @Post('routes/:id/book')
  book(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BookFrequentRideDto,
  ) {
    return this.frequent.book(user.id, id, dto);
  }

  @Delete('bookings/:id')
  cancelBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.frequent.cancelBooking(user.id, id);
  }
}

@ApiTags('admin-frequent-rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/frequent-rides')
export class AdminFrequentRidesController {
  constructor(private readonly frequent: FrequentRidesService) {}

  @Get('applications')
  applications() {
    return this.frequent.pendingApplications();
  }

  @Patch('applications/:id')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewFrequentRideApplicationDto,
  ) {
    return this.frequent.reviewApplication(user.id, id, dto);
  }
}
