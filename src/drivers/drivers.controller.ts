import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  DriverDocumentsService,
  MAX_DOCUMENT_BYTES,
} from './driver-documents.service.js';
import { UploadDocumentDto } from './dto/document.dto.js';
import { ApplyDriverDto, VehicleDto } from './dto/driver.dto.js';
import { DriversService } from './drivers.service.js';

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly documents: DriverDocumentsService,
  ) {}

  @Post('apply')
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyDriverDto) {
    return this.drivers.apply(user.id, dto);
  }

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.drivers.getMine(user.id);
  }

  @Post('me/vehicles')
  addVehicle(@CurrentUser() user: AuthUser, @Body() dto: VehicleDto) {
    return this.drivers.addVehicle(user.id, dto);
  }

  @Delete('me/vehicles/:id')
  removeVehicle(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.drivers.removeVehicle(user.id, id);
  }

  // multipart/form-data: `file` (JPEG/PNG/WebP/PDF, max 5 MB) + `type` (+ `vehicleId`).
  @Post('me/documents')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: [
            'cnic_front',
            'cnic_back',
            'license_front',
            'license_back',
            'selfie',
            'vehicle_registration',
          ],
        },
        vehicleId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.documents.upload(user.id, dto, file);
  }

  @Get('me/documents')
  listDocuments(@CurrentUser() user: AuthUser) {
    return this.documents.listMine(user.id);
  }
}
