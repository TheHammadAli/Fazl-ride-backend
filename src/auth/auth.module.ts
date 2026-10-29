import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  FazlAdminApiVerifier,
  FazlAdminVerifier,
} from './fazl-admin/fazl-admin.verifier.js';
import {
  GoogleCertsVerifier,
  GoogleIdTokenVerifier,
} from './google/google-id-token.verifier.js';
import { JwtStrategy } from './jwt.strategy.js';
import { ConsoleSmsProvider } from './sms/console-sms.provider.js';
import { SmsProvider } from './sms/sms.provider.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL') ?? '15m' },
      }),
    }),
  ],
  exports: [PassportModule, JwtModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AdminBootstrapService,
    JwtStrategy,
    { provide: SmsProvider, useClass: ConsoleSmsProvider },
    { provide: GoogleIdTokenVerifier, useClass: GoogleCertsVerifier },
    { provide: FazlAdminVerifier, useClass: FazlAdminApiVerifier },
  ],
})
export class AuthModule {}
