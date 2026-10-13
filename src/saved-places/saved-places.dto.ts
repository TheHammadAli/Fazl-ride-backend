import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { LatLngDto } from '../common/dto/geo.dto.js';

export class SavePlaceDto extends LatLngDto {
  @IsIn(['home', 'work', 'other'])
  kind: 'home' | 'work' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  address: string;
}
