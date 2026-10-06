import {
  Controller,
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
import { FreightService, MAX_LOAD_PHOTO_BYTES } from './freight.service.js';

@ApiTags('freight')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('freight')
export class FreightController {
  constructor(private readonly freight: FreightService) {}

  // multipart/form-data: `file` (JPEG/PNG/WebP, max 5 MB).
  @Post('load-photo')
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
      limits: { fileSize: MAX_LOAD_PHOTO_BYTES, files: 1 },
    }),
  )
  uploadLoadPhoto(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.freight.uploadLoadPhoto(user.id, file);
  }
}
