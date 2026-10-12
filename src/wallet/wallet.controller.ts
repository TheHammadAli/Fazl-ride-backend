import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import {
  AddChangeDto,
  PageQueryDto,
  TopupRequestDto,
  WithdrawalRequestDto,
} from './dto/wallet.dto.js';
import { MAX_PROOF_BYTES, WalletService } from './wallet.service.js';

// The signed-in person's own wallet (passengers and drivers alike).
@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  // Balance, dues, limits, top-up instructions and requests still waiting.
  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.wallet.summary(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.wallet.transactions(user.id, {
      limit: query.limit ?? 20,
      cursor: query.cursor,
    });
  }

  @Get('requests')
  requests(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.wallet.requests(user.id, {
      limit: query.limit ?? 20,
      cursor: query.cursor,
    });
  }

  // multipart/form-data: `file` (JPEG/PNG/WebP, max 5 MB) - the transfer's
  // screenshot, then sent as `proofKey` with the top-up.
  @Post('proof')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PROOF_BYTES, files: 1 },
    }),
  )
  uploadProof(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.wallet.uploadProof(user.id, file);
  }

  @Post('topups')
  topup(@CurrentUser() user: AuthUser, @Body() dto: TopupRequestDto) {
    return this.wallet.requestTopup(user.id, dto);
  }

  @Post('withdrawals')
  @Roles(Role.driver)
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawalRequestDto) {
    return this.wallet.requestWithdrawal(user.id, dto);
  }

  @Post('requests/:id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.wallet.cancelRequest(user.id, id);
  }

  // Driver: put a cash ride's change into the passenger's wallet.
  @Post('change')
  @Roles(Role.driver)
  addChange(@CurrentUser() user: AuthUser, @Body() dto: AddChangeDto) {
    return this.wallet.addChange(user.id, dto);
  }
}
