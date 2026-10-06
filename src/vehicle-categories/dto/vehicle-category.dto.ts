import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { KNOWN_VEHICLE_ICON_KEYS, VEHICLE_SERVICES } from '../vehicle-icons.js';

// The starting fare rules a brand-new category needs (see fare_configs);
// the same numbers/limits as UpdateFareConfigDto.
class NewFareConfigDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  baseFare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  perKm: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  perMinute: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  minimumFare: number;
}

export class CreateVehicleCategoryDto {
  // Lowercase, letters/digits/underscores: the stable id used in the API and
  // stored on vehicles/rides/driver_presence (e.g. "rickshaw", "mini_van").
  @Matches(/^[a-z][a-z0-9_]{1,29}$/, {
    message:
      'key must be lowercase letters, digits or underscores, starting with a letter (2-30 characters)',
  })
  key: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  // One of the icons the client apps already know how to draw; anything else
  // still works, it just shows a generic vehicle icon until clients are
  // updated to recognise the new key.
  @IsIn(KNOWN_VEHICLE_ICON_KEYS)
  iconKey: string;

  // 'ride' (passengers) or 'freight' (goods). Defaults to ride.
  @IsOptional()
  @IsIn(VEHICLE_SERVICES)
  service?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => NewFareConfigDto)
  fare: NewFareConfigDto;
}

// Every field optional so an admin can change one thing at a time (rename,
// switch icon, deactivate, reorder). The key itself and its fares are not
// changed here - fares stay under PUT admin/fares/:category.
export class UpdateVehicleCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @IsIn(KNOWN_VEHICLE_ICON_KEYS)
  iconKey?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Move a type between passenger rides and freight (goods).
  @IsOptional()
  @IsIn(VEHICLE_SERVICES)
  service?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
