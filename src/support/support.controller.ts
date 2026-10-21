import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  CategoriesQueryDto,
  CreateTicketDto,
  ListTicketsDto,
  ResolveTicketDto,
  TicketMessageDto,
  UpdateTicketDto,
} from './dto/support.dto.js';
import { SupportService } from './support.service.js';

// Passengers and drivers: report a problem, follow it, write back.
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('categories')
  categories(@Query() query: CategoriesQueryDto) {
    return this.support.categories(query.role);
  }

  @Post('tickets')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.create(user.id, dto);
  }

  @Get('tickets')
  list(@CurrentUser() user: AuthUser) {
    return this.support.listMine(user.id);
  }

  @Get('tickets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.mine(user.id, id);
  }

  @Post('tickets/:id/messages')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketMessageDto,
  ) {
    return this.support.reply(user.id, id, dto.body);
  }
}

// Support staff: the complaints queue.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query() query: ListTicketsDto) {
    return this.support.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.get(id);
  }

  @Post(':id/messages')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketMessageDto,
  ) {
    return this.support.adminReply(user.id, id, dto.body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.update(user.id, id, dto);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTicketDto,
  ) {
    return this.support.resolve(user.id, id, dto.resolution, dto.refundAmount);
  }
}
