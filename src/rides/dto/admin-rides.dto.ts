import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { RideStatus, TripType } from '../../generated/prisma/enums.js';

export class ListRidesDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus;

  // Not a fixed enum any more (see admin/vehicle-categories); an unknown
  // value here just matches no rides instead of being rejected.
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(TripType)
  tripType?: TripType;

  @IsOptional()
  @IsUUID()
  passengerId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  // Requested at or after / before these moments (ISO 8601).
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // Rides under way right now (requested, accepted, arrived, started).
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;

  // Pickup/drop-off address, passenger or driver name/phone, or ride id.
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(60)
  search?: string;
}

export class AdminCancelRideDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}
