import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsProvider } from './sms/sms.provider.js';

const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsProvider,
  ) {}

  async requestOtp(phone: string) {
    const last = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (
      last &&
      Date.now() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000
    ) {
      throw new HttpException(
        `Please wait ${OTP_RESEND_SECONDS} seconds before requesting a new code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttl = Number(this.config.get('OTP_TTL_SECONDS') ?? 300);
    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: this.hashOtp(phone, code),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    await this.sms.send(phone, `Your FAZL verification code is ${code}`);
    return { message: 'OTP sent', expiresInSeconds: ttl };
  }

  async verifyOtp(phone: string, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    const expected = Buffer.from(otp.codeHash);
    const actual = Buffer.from(this.hashOtp(phone, code));
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    // Atomic: a code can be used only once even with concurrent requests.
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const user = await this.findOrCreateUser(phone);
    if (user.status === 'blocked') {
      throw new ForbiddenException('Account is blocked');
    }
    return this.issueTokens(user.id);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // A revoked token being replayed means it may have been stolen.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.user.status === 'blocked') {
      throw new ForbiddenException('Account is blocked');
    }

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(stored.userId);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out' };
  }

  private async findOrCreateUser(phone: string) {
    // Everyone registers as a customer; driver / operator roles come later via approval.
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, roles: { create: { role: Role.customer } } },
    });

    const superAdmins = (this.config.get<string>('SUPER_ADMIN_PHONES') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (superAdmins.includes(phone)) {
      await this.prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role: Role.super_admin } },
        update: {},
        create: { userId: user.id, role: Role.super_admin },
      });
    }
    return user;
  }

  private async issueTokens(userId: string) {
    const ttlDays = Number(this.config.get('REFRESH_TTL_DAYS') ?? 30);
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId });
    return { accessToken, refreshToken };
  }

  private hashOtp(phone: string, code: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET'))
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
