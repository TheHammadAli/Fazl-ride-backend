import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RateRideDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comment?: string;

  // The customer says the AC did not work (only counted on AC tiers).
  @IsOptional()
  @IsBoolean()
  acIssue?: boolean;
}
