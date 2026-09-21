import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SCOPE_PATTERN } from '../scopes.js';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(SCOPE_PATTERN, {
    each: true,
    message: 'each scope must look like "parking:write", "orders:*" or "*"',
  })
  scopes: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
