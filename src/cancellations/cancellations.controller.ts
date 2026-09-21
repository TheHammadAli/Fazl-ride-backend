import {
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
import { CancellationsService } from './cancellations.service.js';

// So the apps can show "you can book again at 3:40 PM" instead of a bare error.
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me/cancellation-status')
export class CancellationStatusController {
  constructor(private readonly cancellations: CancellationsService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const [passenger, driver] = await Promise.all([
      this.cancellations.status(user.id, 'passenger'),
      this.cancellations.status(user.id, 'driver'),
    ]);
    return { passenger, driver };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/users/:id/cancellations')
export class AdminCancellationsController {
  constructor(private readonly cancellations: CancellationsService) {}

  @Get()
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const [passenger, driver, history] = await Promise.all([
      this.cancellations.status(id, 'passenger'),
      this.cancellations.status(id, 'driver'),
      this.cancellations.history(id),
    ]);
    return { passenger, driver, history };
  }

  @Post('reset')
  @HttpCode(200)
  reset(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.cancellations.forgive(id, admin.id);
  }
}
