import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';

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

  // Not a fixed enum any more (see admin/vehicle-categories); RidesService
  // rejects an unknown/inactive one when it looks up the fare for it.
  @IsString()
  @IsNotEmpty()
  category: string;

  // A negotiable ride only: what the passenger offers to pay. Left out, the
  // suggested price from the fare table is used instead.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  offeredFare?: number;

  // A negotiable ride only: accept the first bid at or below offeredFare
  // right away instead of waiting for the passenger to choose.
  @IsOptional()
  @IsBoolean()
  autoAccept?: boolean;
}

export class CancelRideDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
