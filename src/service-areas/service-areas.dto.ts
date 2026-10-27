import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateServiceCityDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  country?: string;

  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(150)
  radiusKm?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateServiceCityDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(150)
  radiusKm?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ServiceAreaRuleDto {
  @IsBoolean()
  onlyServiceCities: boolean;
}
