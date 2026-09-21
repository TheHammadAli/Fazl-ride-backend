import { Type } from 'class-transformer';
import {
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';

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
}
