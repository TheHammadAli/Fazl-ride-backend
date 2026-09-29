import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
