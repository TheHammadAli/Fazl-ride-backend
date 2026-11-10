import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class FrequentRideStopDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

export class CreateFrequentRideRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  departureTime: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  days: number[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  seats: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  fare: number;

  @IsString()
  @IsUUID()
  vehicleId: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => FrequentRideStopDto)
  stops: FrequentRideStopDto[];
}

export class UpdateFrequentRideRouteDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SearchFrequentRidesDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @Type(() => Number)
  @IsLatitude()
  pickupLat: number;

  @Type(() => Number)
  @IsLongitude()
  pickupLng: number;

  @Type(() => Number)
  @IsLatitude()
  dropoffLat: number;

  @Type(() => Number)
  @IsLongitude()
  dropoffLng: number;
}

export class BookFrequentRideDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  fromPosition: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  toPosition: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  seats?: number;
}

export class ReviewFrequentRideApplicationDto {
  @Matches(/^(approved|rejected)$/)
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
