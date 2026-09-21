import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { EstimateRideDto } from './dto/ride.dto.js';
import { CancelRideDto, RequestRideDto } from './dto/request-ride.dto.js';
import { RateRideDto } from './dto/rate-ride.dto.js';
import { RatingsService } from './ratings.service.js';
import { FaresService } from './fares.service.js';
import { RidesService } from './rides.service.js';

@ApiTags('rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rides')
export class RidesController {
  constructor(
    private readonly fares: FaresService,
    private readonly rides: RidesService,
    private readonly ratings: RatingsService,
  ) {}

  // Read-only price quote, creates nothing.
  @Post('estimate')
  @HttpCode(200)
  estimate(@Body() dto: EstimateRideDto) {
    return this.fares.estimate(dto.pickup, dto.dropoff);
  }

  @Post()
  request(@CurrentUser() user: AuthUser, @Body() dto: RequestRideDto) {
    return this.rides.request(user.id, dto);
  }

  // Must stay above ':id' so "active" is not read as an id.
  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.rides.activeFor(user.id, 'passenger');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.get(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRideDto,
  ) {
    return this.rides.cancel(user.id, id, dto);
  }

  @Post(':id/rate')
  @HttpCode(200)
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateRideDto,
  ) {
    return this.ratings.rate(user.id, id, dto);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rides.accept(user.id, id);
  }

  @Post(':id/arrived')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  arrived(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rides.arrived(user.id, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.start(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rides.complete(user.id, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles(Role.driver)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rides.decline(user.id, id);
  }
}

// What the Driver app polls (until sockets arrive): pending offers and the ride in progress.
@ApiTags('driver-rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.driver)
@Controller('drivers/me')
export class DriverRidesController {
  constructor(private readonly rides: RidesService) {}

  @Get('offers')
  offers(@CurrentUser() user: AuthUser) {
    return this.rides.offersFor(user.id);
  }

  @Get('active-ride')
  activeRide(@CurrentUser() user: AuthUser) {
    return this.rides.activeFor(user.id, 'driver');
  }
}
