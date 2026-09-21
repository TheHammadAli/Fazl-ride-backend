import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service.js';

// The customer's app: opens one order with the tracking token it was given.
// The token goes in a header, not in the URL, so it does not end up in server logs.
@ApiTags('tracking')
@ApiHeader({ name: 'x-tracking-token', required: true })
@Controller('tracking')
export class TrackingController {
  constructor(private readonly orders: OrdersService) {}

  @Get('order')
  order(@Headers('x-tracking-token') token?: string) {
    if (!token) throw new UnauthorizedException('Missing tracking token');
    return this.orders.viewForToken(token);
  }
}
