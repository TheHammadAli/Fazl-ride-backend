import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../api-keys/api-key.guard.js';
import { Scopes } from '../api-keys/scopes.js';
import {
  OrderLocationDto,
  SourceQueryDto,
  TrackingSessionDto,
  UpsertOrderDto,
} from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

// What the other system (FAZL APP's backend) calls. Every call carries an API key
// with the `orders:write` scope (`orders:read` to read back). It sends what it
// knows; we keep the order, tell the customer's app, and hand out tracking links.
@ApiTags('integrations')
@ApiHeader({ name: 'x-api-key', required: true })
@UseGuards(ApiKeyGuard)
// One integration can be busy: many orders, each reporting a position every few seconds.
@Throttle({
  default: {
    limit: Number(process.env.INTEGRATION_THROTTLE_LIMIT ?? 6000),
    ttl: 60_000,
  },
})
@Controller('integrations/orders')
export class IntegrationOrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Create or update an order. Safe to repeat: the same call twice changes nothing.
  @Put(':externalId')
  @Scopes('orders:write')
  upsert(@Param('externalId') externalId: string, @Body() dto: UpsertOrderDto) {
    return this.orders.upsert(externalId, dto);
  }

  // The delivery person's current position (and the ETA, if the system has one).
  @Post(':externalId/location')
  @HttpCode(200)
  @Scopes('orders:write')
  location(
    @Param('externalId') externalId: string,
    @Query() query: SourceQueryDto,
    @Body() dto: OrderLocationDto,
  ) {
    return this.orders.recordLocation(query.source ?? 'fazl', externalId, dto);
  }

  // A token the customer's app uses to open this order without logging in.
  @Post(':externalId/tracking-session')
  @Scopes('orders:write')
  session(
    @Param('externalId') externalId: string,
    @Query() query: SourceQueryDto,
    @Body() dto: TrackingSessionDto,
  ) {
    return this.orders.createTrackingSession(
      query.source ?? 'fazl',
      externalId,
      dto.ttlHours,
    );
  }

  @Post(':externalId/tracking-session/revoke')
  @HttpCode(200)
  @Scopes('orders:write')
  revoke(
    @Param('externalId') externalId: string,
    @Query() query: SourceQueryDto,
  ) {
    return this.orders.revokeTrackingSessions(
      query.source ?? 'fazl',
      externalId,
    );
  }

  @Get(':externalId')
  @Scopes('orders:read')
  get(@Param('externalId') externalId: string, @Query() query: SourceQueryDto) {
    return this.orders.viewBySource(query.source ?? 'fazl', externalId);
  }
}
