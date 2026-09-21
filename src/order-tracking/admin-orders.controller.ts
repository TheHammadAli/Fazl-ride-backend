import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { AdminOrdersService } from './admin-orders.service.js';
import {
  CreateStatusDto,
  ListOrdersDto,
  UpdateStatusDto,
} from './dto/admin-order.dto.js';
import { OrderStatusService } from './order-status.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin')
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly statuses: OrderStatusService,
  ) {}

  @Get('orders')
  list(@Query() query: ListOrdersDto) {
    return this.orders.list(query);
  }

  @Get('orders/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Get('order-statuses')
  listStatuses() {
    return this.statuses.all();
  }

  @Post('order-statuses')
  createStatus(@Body() dto: CreateStatusDto, @CurrentUser() admin: AuthUser) {
    return this.statuses.create(dto, admin.id);
  }

  @Put('order-statuses/:key')
  updateStatus(
    @Param('key') key: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.statuses.update(key, dto, admin.id);
  }
}
