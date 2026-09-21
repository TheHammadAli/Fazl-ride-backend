import { IsString, Length, MinLength } from 'class-validator';
import { IsPkPhone } from '../../common/dto/phone.decorator.js';

export class RequestOtpDto {
  @IsPkPhone()
  phone: string;
}

export class VerifyOtpDto {
  @IsPkPhone()
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
