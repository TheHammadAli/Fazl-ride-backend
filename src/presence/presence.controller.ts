import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { DestinationService } from './destination.service.js';
import {
  DestinationDto,
  GoOnlineDto,
  LocationUpdateDto,
} from './dto/presence.dto.js';
import { PresenceService } from './presence.service.js';

// Driver mode only: the `driver` role is granted when an admin approves the driver.
@ApiTags('driver-presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.driver)
@Controller('drivers/me')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly destination: DestinationService,
  ) {}

  // Destination mode: only rides heading this way while it is on.
  @Get('destination')
  getDestination(@CurrentUser() user: AuthUser) {
    return this.destination.get(user.id);
  }

  @Post('destination')
  @HttpCode(200)
  setDestination(@CurrentUser() user: AuthUser, @Body() dto: DestinationDto) {
    return this.destination.set(user.id, dto);
  }

  @Delete('destination')
  clearDestination(@CurrentUser() user: AuthUser) {
    return this.destination.clear(user.id);
  }

  @Post('online')
  @HttpCode(200)
  goOnline(@CurrentUser() user: AuthUser, @Body() dto: GoOnlineDto) {
    return this.presence.goOnline(user.id, dto);
  }

  @Post('offline')
  @HttpCode(200)
  goOffline(@CurrentUser() user: AuthUser) {
    return this.presence.goOffline(user.id);
  }

  // Send every few seconds while online (heading in degrees, speed in km/h).
  @Post('location')
  @HttpCode(200)
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Body() dto: LocationUpdateDto,
  ) {
    return this.presence.updateLocation(user.id, dto);
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.presence.status(user.id);
  }
}
