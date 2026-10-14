import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateDriverLevelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) minRides?: number;
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be like #F59E0B' })
  color?: string;
  @IsOptional() @IsString() @MaxLength(20) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(50) commissionDiscount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) bonus?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50_000) priorityMeters?: number;
  @IsOptional() @IsInt() @Min(-1_000_000) @Max(0) minBalance?: number | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  perks?: string[];
}

export class CreateDriverLevelDto extends UpdateDriverLevelDto {
  @Matches(/^[a-z][a-z0-9_]{1,29}$/, {
    message: 'key must be lowercase letters, digits or underscores',
  })
  key: string;

  @IsString() @MinLength(1) @MaxLength(30) declare name: string;
  @IsInt() @Min(1) @Max(1_000_000) declare minRides: number;
}
