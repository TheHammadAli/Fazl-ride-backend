import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeyGuard } from './api-key.guard.js';
import {
  ApiKeysController,
  IntegrationsController,
} from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';

// Import this module in any feature module that has API-key protected routes.
@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController, IntegrationsController],
  providers: [ApiKeysService, ApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard],
})
export class ApiKeysModule {}
