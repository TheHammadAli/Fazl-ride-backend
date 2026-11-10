import { Type } from 'class-transformer';
import { VEHICLE_SERVICES } from '../../vehicle-categories/vehicle-icons.js';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';
import { TripType } from '../../generated/prisma/enums.js';
import { MAX_STOPS } from '../stop-waiting.js';

// The app sends the same pickup/drop-off objects to the estimate and to the
// request, so the estimate accepts the address text too (it just does not need it).
export class EstimatePlaceDto extends LatLngDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;
}

export class EstimateRideDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => EstimatePlaceDto)
  pickup: EstimatePlaceDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => EstimatePlaceDto)
  dropoff: EstimatePlaceDto;

  // Stops on the way, in order (rides only); the route and fare go through them.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STOPS)
  @ValidateNested({ each: true })
  @Type(() => EstimatePlaceDto)
  stops?: EstimatePlaceDto[];

  // Defaults to within_city. city_to_city uses a separate rate card and a
  // much longer allowed distance; matching itself does not change.
  @IsOptional()
  @IsEnum(TripType)
  tripType?: TripType;

  // 'ride' (default) or 'freight'.
  @IsOptional()
  @IsIn(VEHICLE_SERVICES)
  service?: string;
}
