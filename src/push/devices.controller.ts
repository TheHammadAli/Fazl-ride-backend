import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { DevicesService } from './devices.service.js';

class DeviceDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token: string;
}

class RegisterDeviceDto extends DeviceDto {
  @IsIn(['android', 'ios'])
  platform: 'android' | 'ios';
}

// The app tells us which phone to send push notifications to.
@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(200)
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(user.id, dto.token, dto.platform);
  }

  @Delete()
  unregister(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto) {
    return this.devices.unregister(user.id, dto.token);
  }
}
