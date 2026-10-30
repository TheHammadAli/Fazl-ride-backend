import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminPromosController,
  PromosController,
} from './promos.controller.js';
import { PromosService } from './promos.service.js';

// Promo codes (admin panel: Promotions). Rides use the exported service to
// hold a code on request and apply it at completion.
@Module({
  imports: [AuthModule],
  controllers: [PromosController, AdminPromosController],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosModule {}
