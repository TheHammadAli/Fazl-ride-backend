import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, TripType } from '../../generated/prisma/enums.js';
import { PlaceDto } from './request-ride.dto.js';

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export class CreateRideScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PlaceDto)
  pickup: PlaceDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => PlaceDto)
  dropoff: PlaceDto;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsOptional()
  @IsEnum(TripType)
  tripType?: TripType;

  // 1 = Monday ... 7 = Sunday.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days: number[];

  // "08:30", business time.
  @Matches(TIME, { message: 'time must be HH:mm' })
  time: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  offeredFare?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class UpdateRideScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days?: number[];

  @IsOptional()
  @Matches(TIME, { message: 'time must be HH:mm' })
  time?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  offeredFare?: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  // Pause (false) or resume (true).
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SkipDayDto {
  // "2026-10-15", business time.
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;
}
