import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ActivityService } from './activity.service.js';

class ActivityQueryDto {
  // The History tabs: All / Rides / Deliveries / Parking.
  @IsOptional()
  @IsIn(['all', 'ride', 'delivery', 'parking'])
  type?: string;

  // Passenger app lists trips taken; Driver app lists trips driven.
  @IsOptional()
  @IsIn(['passenger', 'driver'])
  as?: 'passenger' | 'driver';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser, @Query() query: ActivityQueryDto) {
    return this.activity.feed(user.id, {
      type: query.type,
      as: query.as ?? 'passenger',
      limit: query.limit ?? 20,
      cursor: query.cursor,
      phone: user.phone,
    });
  }
}
