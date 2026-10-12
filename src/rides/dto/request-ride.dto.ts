import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../common/dto/geo.dto.js';
import { PaymentMethod, TripType } from '../../generated/prisma/enums.js';

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

  // Defaults to within_city. Must match a fare_config that actually exists
  // for this category (e.g. only "car" has a city_to_city rate card today).
  @IsOptional()
  @IsEnum(TripType)
  tripType?: TripType;

  // A negotiable ride only: what the passenger offers to pay. Left out, the
  // suggested price from the fare table is used instead.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  offeredFare?: number;

  // Freight only: what is being moved.
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  loadDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  loadWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  helpersNeeded?: number;

  // Freight: floor at each end (0 = ground), whether there is a lift, and
  // whether the driver/helpers load and unload.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  pickupFloor?: number;

  @IsOptional()
  @IsBoolean()
  pickupHasLift?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  dropoffFloor?: number;

  @IsOptional()
  @IsBoolean()
  dropoffHasLift?: boolean;

  @IsOptional()
  @IsBoolean()
  needsLoading?: boolean;

  @IsOptional()
  @IsBoolean()
  needsUnloading?: boolean;

  // From POST freight/load-photo. Optional.
  @IsOptional()
  @IsString()
  @Matches(/^freight\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/)
  loadPhotoKey?: string;

  // A negotiable ride only: accept the first bid at or below offeredFare
  // right away instead of waiting for the passenger to choose.
  @IsOptional()
  @IsBoolean()
  autoAccept?: boolean;

  // Defaults to cash. "wallet" takes the fare from the wallet when the ride
  // completes; what the balance does not cover is paid in cash.
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class CancelRideDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
