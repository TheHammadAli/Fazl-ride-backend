import { IsPkPhone } from '../../common/dto/phone.decorator.js';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Someone else's number, called or alerted on an SOS. '' removes it.
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsPkPhone()
  emergencyContact?: string;
}
