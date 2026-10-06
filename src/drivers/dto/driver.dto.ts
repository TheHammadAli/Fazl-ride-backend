import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsISO8601,
  IsInt,
  IsOptional,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { IsPkPhone } from '../../common/dto/phone.decorator.js';
import {
  PLATE_REGEX,
  isLicenseNumber,
  normalizePlate,
} from '../driver-requirements.js';

@ValidatorConstraint({ name: 'licenseNumber' })
class LicenseNumberRule implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isLicenseNumber(value);
  }

  defaultMessage() {
    return 'licenseNumber must be your driving licence number (5-20 characters, at least 4 digits)';
  }
}

const DATE_ONLY = { strict: true, strictSeparator: true } as const;

export class VehicleDto {
  // Not a fixed enum any more (see admin/vehicle-categories); DriversService
  // rejects an unknown/inactive one.
  @IsString()
  @IsNotEmpty()
  category: string;

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
  @Matches(/^[\p{L} ]+$/u, {
    message: 'color must be a colour name, e.g. White',
  })
  color: string;

  // Stored normalised (LEA-1234), so "lea 1234" and "LEA-1234" are the
  // same plate for the unique check.
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePlate(value) : value,
  )
  @IsString()
  @Matches(PLATE_REGEX, {
    message: 'plateNumber must look like a Pakistani plate, e.g. LEA-1234',
  })
  plateNumber: string;
}

export class ApplyDriverDto {
  // 13 digits; dashes (12345-1234567-1) are accepted and stripped.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/-/g, '') : value,
  )
  // The first digit is the province code (1-7).
  @Matches(/^[1-7]\d{12}$/, { message: 'cnic must be a valid 13-digit CNIC' })
  cnic: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Validate(LicenseNumberRule)
  licenseNumber: string;

  // YYYY-MM-DD. Must not be in the past.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'licenseExpiry must be YYYY-MM-DD',
  })
  @IsISO8601(DATE_ONLY)
  licenseExpiry: string;

  // YYYY-MM-DD. The driver must be at least 18.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  @IsISO8601(DATE_ONLY)
  dateOfBirth: string;

  // Someone to call if something happens on a trip; not the driver's own number.
  @IsPkPhone()
  emergencyContact: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => VehicleDto)
  vehicle: VehicleDto;
}

// Filling in or correcting the driver's own details after applying. Changing
// an already-set date of birth or licence expiry sends an approved driver
// back for review; the emergency contact can change freely.
export class UpdateDriverProfileDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'licenseExpiry must be YYYY-MM-DD',
  })
  @IsISO8601(DATE_ONLY)
  licenseExpiry?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  @IsISO8601(DATE_ONLY)
  dateOfBirth?: string;

  @IsOptional()
  @IsPkPhone()
  emergencyContact?: string;

  // Correctable until approved.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/-/g, '') : value,
  )
  @Matches(/^[1-7]\d{12}$/, { message: 'cnic must be a valid 13-digit CNIC' })
  cnic?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Validate(LicenseNumberRule)
  licenseNumber?: string;
}

// Correcting a vehicle before it is approved; only the fields given change.
export class UpdateVehicleDto extends PartialType(VehicleDto) {}
