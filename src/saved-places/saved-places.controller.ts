import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SavePlaceDto } from './saved-places.dto.js';
import { SavedPlacesService } from './saved-places.service.js';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('saved-places')
export class SavedPlacesController {
  constructor(private readonly places: SavedPlacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.places.list(user.id);
  }

  // Home / Work replace the existing one; "other" adds a place.
  @Post()
  save(@CurrentUser() user: AuthUser, @Body() dto: SavePlaceDto) {
    return this.places.save(user.id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.places.remove(user.id, id);
  }
}
