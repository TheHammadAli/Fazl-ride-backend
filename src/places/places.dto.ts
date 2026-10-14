import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AutocompleteQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  // Where the person is (or the pickup): nearer places come first.
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  // One per search: the typing and the place chosen are billed as one.
  @IsOptional()
  @IsUUID()
  session?: string;
}

export class PlaceDetailsQueryDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  placeId: string;

  @IsOptional()
  @IsUUID()
  session?: string;
}

export class ReverseQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}
