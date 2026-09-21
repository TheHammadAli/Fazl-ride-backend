import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { ApiKeyGuard } from './api-key.guard.js';
import type { ApiKeyPrincipal } from './api-key.guard.js';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/api-key.dto.js';
import { Scopes } from './scopes.js';

// Managing keys is a super admin job: a key can act for a whole integration.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.super_admin)
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.keys.create(dto, user.id);
  }

  @Get()
  list() {
    return this.keys.list();
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.keys.revoke(id, user.id);
  }
}

// Reference for how an integration route is protected. Real modules copy this
// pattern: @UseGuards(ApiKeyGuard) + @Scopes('<resource>:<action>').
@ApiTags('integrations')
@ApiHeader({ name: 'x-api-key', required: true })
@UseGuards(ApiKeyGuard)
@Controller('integrations')
export class IntegrationsController {
  @Get('ping')
  @Scopes('ping:read')
  ping(@Req() req: { apiKey: ApiKeyPrincipal }) {
    return { ok: true, key: req.apiKey.name, scopes: req.apiKey.scopes };
  }
}
