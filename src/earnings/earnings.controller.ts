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
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { Period } from '../common/time.js';
import { Role } from '../generated/prisma/enums.js';
import { EarningsService } from './earnings.service.js';

class EarningsQueryDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: Period;
}

class TransactionsQueryDto {
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

@ApiTags('driver-earnings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.driver)
@Controller('drivers/me')
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.earnings.dashboard(user.id);
  }

  @Get('earnings')
  summary(@CurrentUser() user: AuthUser, @Query() query: EarningsQueryDto) {
    return this.earnings.summary(user.id, query.period ?? 'today');
  }

  @Get('earnings/transactions')
  transactions(
    @CurrentUser() user: AuthUser,
    @Query() query: TransactionsQueryDto,
  ) {
    return this.earnings.transactions(user.id, {
      limit: query.limit ?? 20,
      cursor: query.cursor,
    });
  }
}
