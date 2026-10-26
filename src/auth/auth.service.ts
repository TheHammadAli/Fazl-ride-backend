import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
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
import { verifyPassword } from '../common/password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleIdTokenVerifier } from './google/google-id-token.verifier.js';
import { SmsProvider } from './sms/sms.provider.js';

const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsProvider,
    private readonly google: GoogleIdTokenVerifier,
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
    await this.consumeOtp(phone, code);
    const user = await this.findOrCreateUser(phone);
    if (user.status === 'blocked') {
      throw new ForbiddenException('Account is blocked');
    }
    return this.issueTokens(user.id);
  }

  /**
   * "Continue with Google". A Google account linked to a user signs in at
   * once. Otherwise the app asks the person to confirm their name and give a
   * mobile number, which is texted a code, and finishes with
   * [completeGoogleSignIn]: every account has a verified phone.
   *
   * Never matched by email: the one on a profile is typed in by the user,
   * unverified, so it can't vouch for who owns the Google account.
   */
  async googleSignIn(idToken: string) {
    const google = await this.google.verify(idToken);
    const user = await this.prisma.user.findUnique({
      where: { googleId: google.sub },
    });
    if (!user || user.status === 'deleted') {
      return { needsPhone: true, name: google.name, email: google.email };
    }
    if (user.status === 'blocked') {
      throw new ForbiddenException('Account is blocked');
    }
    return this.issueTokens(user.id);
  }

  /**
   * Finishes a first "Continue with Google": the code texted to [phone]
   * proves the number, and the Google account is linked to the user with it
   * (registered now if it's new). A new account takes the name the person
   * confirmed; one that has a name keeps it (a driver's goes through review).
   * Google's email is added if the account has none and nobody else uses it.
   */
  async completeGoogleSignIn(
    idToken: string,
    name: string,
    phone: string,
    code: string,
  ) {
    const google = await this.google.verify(idToken);

    // Everything that would refuse it, before the code is used up.
    const linked = await this.prisma.user.findUnique({
      where: { googleId: google.sub },
    });
    if (linked && linked.status !== 'deleted' && linked.phone !== phone) {
      throw new ConflictException(
        'This Google account is already linked to another mobile number',
      );
    }
    const byPhone = await this.prisma.user.findUnique({ where: { phone } });
    if (byPhone?.googleId && byPhone.googleId !== google.sub) {
      throw new ConflictException(
        'This mobile number is already linked to another Google account',
      );
    }
    if (byPhone?.status === 'blocked') {
      throw new ForbiddenException('Account is blocked');
    }

    await this.consumeOtp(phone, code);
    const user = byPhone ?? (await this.findOrCreateUser(phone));
    const emailTaken =
      !user.email &&
      (await this.prisma.user.count({ where: { email: google.email } })) > 0;
    await this.prisma.$transaction([
      // A deleted account's link is let go, so the Google account can start again.
      this.prisma.user.updateMany({
        where: { googleId: google.sub, id: { not: user.id } },
        data: { googleId: null },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: google.sub,
          ...(user.name?.trim() ? {} : { name: name.trim() }),
          ...(user.email || emailTaken ? {} : { email: google.email }),
        },
      }),
    ]);
    return this.issueTokens(user.id);
  }

  /** Checks [code] for [phone] and uses it up; 401 if it's wrong or expired. */
  private async consumeOtp(phone: string, code: string) {
    // Testing only: any phone logs in with one fixed code, no SMS needed.
    // Never true in production - see DEV_OTP_BYPASS in .env.example.
    if (this.devBypassCode() === code) {
      this.logger.warn(`DEV_OTP_BYPASS used for ${phone}`);
      return;
    }

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
  }

  async adminLogin(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { roles: true },
    });
    // Always verify, even for an unknown email, so timing does not leak which exist.
    const passwordOk = await verifyPassword(password, user?.passwordHash);
    const isAdmin = user?.roles.some(
      (r) => r.role === Role.admin || r.role === Role.super_admin,
    );
    // One message for every failure: never say which part was wrong.
    if (!user || !passwordOk || !isAdmin) {
      throw new UnauthorizedException('Invalid email or password');
    }
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

  // Returns the fixed code that logs anyone in while DEV_OTP_BYPASS=true, or
  // null when the bypass is off (its default) - so `null === code` never matches.
  private devBypassCode(): string | null {
    const enabled =
      String(this.config.get('DEV_OTP_BYPASS') ?? '').toLowerCase() === 'true';
    return enabled ? (this.config.get<string>('DEV_OTP_CODE') ?? '123456') : null;
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
