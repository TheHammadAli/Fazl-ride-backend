import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';

// Names the other system may use for itself, e.g. "fazl". Lower case, no spaces.
export const SOURCE_PATTERN = /^[a-z0-9_-]{2,30}$/;

export class SourceQueryDto {
  @IsOptional()
  @Matches(SOURCE_PATTERN)
  source?: string;
}

export class OrderPlaceDto extends LatLngDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class DeliveryPersonDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  photoUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number;
}

export class OrderVehicleDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  plate?: string;
}

// Create or update. Every field is optional except that a NEW order needs `delivery`;
// sending only what changed is fine.
export class UpsertOrderDto {
  @IsOptional()
  @Matches(SOURCE_PATTERN)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderPlaceDto)
  pickup?: OrderPlaceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderPlaceDto)
  delivery?: OrderPlaceDto;

  // A status key, or one of its aliases (see the status list).
  @IsOptional()
  @IsString()
  @MaxLength(60)
  status?: string;

  // When the step happened, if it was not "just now".
  @IsOptional()
  @IsDateString()
  statusAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPersonDto)
  deliveryPerson?: DeliveryPersonDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderVehicleDto)
  vehicle?: OrderVehicleDto;
}

export class OrderLocationDto extends LatLngDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  // The other system's own estimate, in seconds. Ours is used when this is missing or stale.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86_400)
  etaSeconds?: number;

  @IsOptional()
  @IsDateString()
  at?: string;
}

export class TrackingSessionDto {
  // How long the link works. Defaults to 24 hours.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  ttlHours?: number;
}
