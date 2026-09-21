import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { MAX_AVATAR_BYTES, UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Patch()
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserDto) {
    return this.users.updateMe(user.id, dto);
  }

  // multipart/form-data: `file` (JPEG/PNG/WebP, max 2 MB)
  @Post('avatar')
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
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
    }),
  )
  setAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.users.setAvatar(user.id, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.users.removeAvatar(user.id);
  }

  // Permanently erases the account's personal data (store requirement).
  @Delete()
  deleteMe(@CurrentUser() user: AuthUser) {
    return this.users.deleteMe(user.id);
  }
}
