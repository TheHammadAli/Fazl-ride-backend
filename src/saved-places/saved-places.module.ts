import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SavedPlacesController } from './saved-places.controller.js';
import { SavedPlacesService } from './saved-places.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SavedPlacesController],
  providers: [SavedPlacesService],
})
export class SavedPlacesModule {}
