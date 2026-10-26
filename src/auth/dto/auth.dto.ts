import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
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

/** "Continue with Google": the ID token the app got from Google. */
export class GoogleSignInDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  idToken: string;
}

/** Finishing a first "Continue with Google": the name the person confirmed
 *  and their mobile number, with the code texted to it. */
export class CompleteGoogleSignInDto extends GoogleSignInDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;

  @IsPkPhone()
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;
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
