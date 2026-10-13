import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import {
  CreateRideScheduleDto,
  SkipDayDto,
  UpdateRideScheduleDto,
} from './dto/ride-schedule.dto.js';
import { SchedulesService } from './schedules.service.js';

// Frequent traveler: the customer's regular trips.
@ApiTags('rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ride-schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.schedules.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRideScheduleDto) {
    return this.schedules.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRideScheduleDto,
  ) {
    return this.schedules.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.schedules.remove(user.id, id);
  }

  @Post(':id/skip')
  skip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SkipDayDto,
  ) {
    return this.schedules.skip(user.id, id, dto.date);
  }

  @Delete(':id/skip/:date')
  unskip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date') date: string,
  ) {
    return this.schedules.unskip(user.id, id, date);
  }
}
