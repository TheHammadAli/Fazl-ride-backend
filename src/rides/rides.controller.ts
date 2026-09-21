import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { EstimateRideDto } from './dto/ride.dto.js';
import { FaresService } from './fares.service.js';

@ApiTags('rides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rides')
export class RidesController {
  constructor(private readonly fares: FaresService) {}

  // Read-only price quote, creates nothing.
  @Post('estimate')
  @HttpCode(200)
  estimate(@Body() dto: EstimateRideDto) {
    return this.fares.estimate(dto.pickup, dto.dropoff);
  }
}
