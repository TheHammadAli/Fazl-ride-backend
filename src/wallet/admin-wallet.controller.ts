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
import {
  AdjustWalletDto,
  AdminRequestsQueryDto,
  AdminWalletsQueryDto,
  ApproveRequestDto,
  RejectRequestDto,
  UpdateWalletSettingsDto,
} from './dto/wallet.dto.js';
import { AdminWalletService } from './admin-wallet.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin, Role.super_admin)
@Controller('admin/wallet')
export class AdminWalletController {
  constructor(private readonly admin: AdminWalletService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Put('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateWalletSettingsDto,
  ) {
    return this.admin.updateSettings(user.id, dto);
  }

  // ?kind=topup|withdrawal&status=pending|approved|rejected|cancelled
  @Get('requests')
  requests(@Query() query: AdminRequestsQueryDto) {
    return this.admin.requests(query);
  }

  @Post('requests/:id/approve')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.admin.approve(user.id, id, dto.reference);
  }

  @Post('requests/:id/reject')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRequestDto,
  ) {
    return this.admin.reject(user.id, id, dto.reason);
  }

  // ?search=name-or-phone&dues=true
  @Get('wallets')
  wallets(@Query() query: AdminWalletsQueryDto) {
    return this.admin.wallets(query);
  }

  @Get('wallets/:userId')
  walletOf(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.walletOf(userId);
  }

  @Post('wallets/:userId/adjust')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdjustWalletDto,
  ) {
    return this.admin.adjust(user.id, userId, dto);
  }
}
