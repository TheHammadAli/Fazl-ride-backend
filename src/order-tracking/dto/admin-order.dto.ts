import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class ListOrdersDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  status?: string;

  // Matches the other system's order id (exact) or a part of it.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deliveryPersonId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export const STATUS_KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

export class CreateStatusDto {
  @Matches(STATUS_KEY_PATTERN, {
    message: 'key must be lower case letters, digits and _',
  })
  key: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position: number;

  @IsOptional()
  @IsBoolean()
  terminal?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  aliases?: string[];
}

export class UpdateStatusDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;

  @IsOptional()
  @IsBoolean()
  terminal?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  aliases?: string[];
}
