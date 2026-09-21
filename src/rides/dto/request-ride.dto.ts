import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
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
}

export class CancelRideDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
