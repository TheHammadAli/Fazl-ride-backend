import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';
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

export class AdminLoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}
