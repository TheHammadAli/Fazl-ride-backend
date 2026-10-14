import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GooglePlacesProvider } from './google-places.provider.js';
import { PlacesController } from './places.controller.js';
import { PlacesProvider } from './places.provider.js';
import { PlacesService } from './places.service.js';

// Place search behind an adapter: replace the binding to use another provider.
@Module({
  imports: [AuthModule],
  controllers: [PlacesController],
  providers: [
    PlacesService,
    { provide: PlacesProvider, useClass: GooglePlacesProvider },
  ],
})
export class PlacesModule {}
