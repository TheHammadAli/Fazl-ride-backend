import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminServiceCitiesController } from './service-areas.controller.js';
import { ServiceAreasService } from './service-areas.service.js';

// Countries & Cities: where FAZL operates (admin panel), and the optional
// rule that rides start only there (used by rides).
@Module({
  imports: [AuthModule],
  controllers: [AdminServiceCitiesController],
  providers: [ServiceAreasService],
  exports: [ServiceAreasService],
})
export class ServiceAreasModule {}
