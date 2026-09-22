import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';
import { VehicleCategory } from '../../generated/prisma/enums.js';

// A point plus the address text the app shows to the driver and in history.
export class PlaceDto extends LatLngDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  address: string;
}

export class RequestRideDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => PlaceDto)
  pickup: PlaceDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => PlaceDto)
  dropoff: PlaceDto;

  @IsEnum(VehicleCategory)
  category: VehicleCategory;

  // A negotiable ride only: what the passenger offers to pay. Left out, the
  // suggested price from the fare table is used instead.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  offeredFare?: number;
}

export class CancelRideDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
