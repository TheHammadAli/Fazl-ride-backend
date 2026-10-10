import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';

export class GoOnlineDto extends LatLngDto {
  // Defaults to the driver's first approved vehicle.
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}

// Destination mode: where the driver is heading.
export class DestinationDto extends LatLngDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  address: string;
}

export class LocationUpdateDto extends LatLngDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(300)
  speedKmh?: number;
}
