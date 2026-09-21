import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { VehicleCategory } from '../../generated/prisma/enums.js';

export class VehicleDto {
  @IsEnum(VehicleCategory)
  category: VehicleCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  make: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  model: string;

  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @IsString()
  @MinLength(2)
  @MaxLength(30)
  color: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(15)
  plateNumber: string;
}

export class ApplyDriverDto {
  // 13 digits; dashes (12345-1234567-1) are accepted and stripped.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/-/g, '') : value,
  )
  @Matches(/^\d{13}$/, { message: 'cnic must be 13 digits' })
  cnic: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  licenseNumber: string;

  @ValidateNested()
  @Type(() => VehicleDto)
  vehicle: VehicleDto;
}
