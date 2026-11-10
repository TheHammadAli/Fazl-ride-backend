import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RideShareService } from './ride-share.service.js';
import { SHARE_PAGE_HTML } from './ride-share.page.js';

// The person on the ride makes and stops share links.
@ApiTags('rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rides')
export class RideShareController {
  constructor(private readonly share: RideShareService) {}

  // Returns {url, expiresAt}; the app opens the phone's share sheet with it.
  @Post(':id/share')
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.share.create(user.id, id, publicBaseUrl(req));
  }

  @Delete(':id/share')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.share.revokeAll(user.id, id);
  }
}

// What the shared page reads, every few seconds. No account needed.
@ApiTags('share')
@Controller('share')
export class SharedTripController {
  constructor(private readonly share: RideShareService) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  view(@Param('token') token: string) {
    return this.share.view(token);
  }
}

// The page itself, at /t/<token> (outside /api/v1, see setup-app.ts) so the
// link people receive is short.
@Controller()
export class SharedTripPageController {
  @Get('t/:token')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  @Header('Referrer-Policy', 'no-referrer')
  page() {
    return SHARE_PAGE_HTML;
  }
}

// PUBLIC_BASE_URL when set (the address phones reach), otherwise the
// address this request came to (Render puts https in x-forwarded-proto).
function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured;
  const proto =
    String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() ||
    req.protocol;
  return `${proto}://${req.get('host')}`;
}
