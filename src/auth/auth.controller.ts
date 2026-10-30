import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import {
  AdminLoginDto,
  CompleteGoogleSignInDto,
  FazlAdminLoginDto,
  GoogleSignInDto,
  RefreshTokenDto,
  RequestOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  // Also registers the user (as a customer) on first successful verification.
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  // "Continue with Google". A linked Google account (or one whose email an
  // account already has) gets the login tokens; a new one gets
  // { needsPhone, name, email } and finishes at google/complete.
  @Post('google')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  googleSignIn(@Body() dto: GoogleSignInDto) {
    return this.auth.googleSignIn(dto.idToken);
  }

  // A first "Continue with Google": the mobile number is verified with the
  // code from otp/request, then linked to the Google account; registers the
  // user if the number is new. Returns the login tokens.
  @Post('google/complete')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  completeGoogleSignIn(@Body() dto: CompleteGoogleSignInDto) {
    return this.auth.completeGoogleSignIn(
      dto.idToken,
      dto.name,
      dto.phone,
      dto.code,
    );
  }

  // The web admin panel logs in with email + password instead of an OTP.
  // Only accounts holding the admin / super_admin role get in.
  @Post('admin/login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  adminLogin(@Body() dto: AdminLoginDto) {
    return this.auth.adminLogin(dto.email, dto.password);
  }

  // Fazl Admin's panel (FazlAdmin) opens Fazl Ride with the admin's Fazl
  // Admin login instead: 401 when Fazl Admin doesn't accept it, 403 when the
  // account has no "Fazl Ride" permission. Returns an access token only.
  @Post('fazl-admin')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  fazlAdminLogin(@Body() dto: FazlAdminLoginDto) {
    return this.auth.fazlAdminLogin(dto.token);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
