import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  REVIEW_ISSUE_FIELDS,
  type ReviewIssueField,
} from '../../drivers/driver-requirements.js';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { DriverStatus, VehicleStatus } from '../../generated/prisma/enums.js';
import { VEHICLE_SERVICES } from '../../vehicle-categories/vehicle-icons.js';

export class ListDriversDto extends PaginationDto {
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;

  // Only applications the driver submitted and nobody has decided yet,
  // oldest first - the admin's review queue.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  awaitingReview?: boolean;
}

export class ListVehiclesDto extends PaginationDto {
  // 'ride' or 'freight': which kind of vehicle type.
  @IsOptional()
  @IsIn(VEHICLE_SERVICES)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  category?: string;

  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  // Plate number, make/model, or the driver's name or phone.
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(40)
  search?: string;
}

export class ListUsersDto extends PaginationDto {
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(20)
  search?: string;
}

export class RejectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

// One thing the driver has to fix: a profile field or a document.
export class ReviewIssueDto {
  @IsIn(REVIEW_ISSUE_FIELDS)
  field: ReviewIssueField;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  message: string;

  // For `vehicle` and the per-vehicle documents.
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}

export class RejectDriverDto extends RejectDto {
  // What exactly to fix; the app shows only these to the driver.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ReviewIssueDto)
  issues?: ReviewIssueDto[];
}

// Ride tiers a vehicle is approved for (keys of tiers of its own type).
// Left out on approval, the tiers the vehicle meets are used.
export class VehicleTiersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tiers?: string[];
}
