import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ChatService } from './chat.service.js';
import { ListMessagesDto, SendMessageDto } from './dto/chat.dto.js';

const DEFAULT_LIMIT = 50;

// In-app chat for one ride, scoped to its passenger and its assigned driver.
@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rides/:id/messages')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(200)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) rideId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.send(user.id, rideId, dto.body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) rideId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.chat.list(user.id, rideId, {
      limit: query.limit ?? DEFAULT_LIMIT,
      cursor: query.cursor,
    });
  }
}
