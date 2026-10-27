import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto.js';

const CODE = /^[A-Za-z0-9_-]{3,20}$/;
const CODE_MESSAGE = 'Use 3-20 letters, digits, - or _';

// '' clears an optional field.
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CheckPromoDto {
  @IsString()
  @MaxLength(20)
  code: string;

  @IsOptional()
  @IsIn(['ride', 'freight'])
  service?: 'ride' | 'freight';

  // The price the passenger sees, to work out the discount.
  @IsOptional()
  @IsInt()
  @Min(0)
  fare?: number;
}

export class CreatePromoDto {
  @Matches(CODE, { message: CODE_MESSAGE })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @IsIn(['percent', 'fixed'])
  discountType: 'percent' | 'fixed';

  @IsInt()
  @Min(1)
  @Max(100_000)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiscount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minFare?: number;

  @IsOptional()
  @IsIn(['ride', 'freight'])
  service?: 'ride' | 'freight';

  @IsOptional()
  @IsBoolean()
  firstRideOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// Every field optional; null clears the optional ones.
export class UpdatePromoDto {
  @IsOptional()
  @Matches(CODE, { message: CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  description?: string | null;

  @IsOptional()
  @IsIn(['percent', 'fixed'])
  discountType?: 'percent' | 'fixed';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  value?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  maxDiscount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  minFare?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['ride', 'freight'])
  service?: 'ride' | 'freight' | null;

  @IsOptional()
  @IsBoolean()
  firstRideOnly?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListPromosDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  search?: string;
}
