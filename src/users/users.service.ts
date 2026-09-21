import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { detectFileType } from '../common/file-type.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_URL_SECONDS = 60 * 60;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        driverProfile: { select: { status: true, rejectionReason: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      avatarUrl: await this.avatarUrl(user.avatarKey),
      roles: user.roles.map((r) => r.role),
      driver: user.driverProfile
        ? {
            status: user.driverProfile.status,
            rejectionReason: user.driverProfile.rejectionReason,
          }
        : null,
    };
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: dto });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('Email is already in use');
      }
      throw error;
    }
    return this.getMe(userId);
  }

  async setAvatar(userId: string, file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A non-empty "file" is required');
    }
    const detected = detectFileType(file.buffer);
    if (!detected || detected.mime === 'application/pdf') {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images are allowed',
      );
    }

    const key = `users/${userId}/avatar-${randomUUID()}.${detected.ext}`;
    await this.storage.upload(key, file.buffer, detected.mime);
    let previous: string | null;
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      previous = user.avatarKey;
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarKey: key },
      });
    } catch (error) {
      await this.removeQuietly([key]);
      throw error;
    }
    if (previous) await this.removeQuietly([previous]);
    return this.getMe(userId);
  }

  async removeAvatar(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null },
    });
    if (user.avatarKey) await this.removeQuietly([user.avatarKey]);
    return this.getMe(userId);
  }

  // Required by the App Store and Google Play. Personal data is erased but the
  // row stays (anonymised) so rides, orders and audit entries keep pointing
  // at a valid user. The phone number is freed, so it can register again.
  async deleteMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (
      user.roles.some((r) => r.role === 'admin' || r.role === 'super_admin')
    ) {
      throw new ForbiddenException(
        'Admin accounts cannot be deleted from the app',
      );
    }

    const documents = await this.prisma.driverDocument.findMany({
      where: { driverProfile: { userId } },
      select: { storageKey: true },
    });
    await this.prisma.$transaction([
      this.prisma.driverProfile.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.otpCode.deleteMany({ where: { phone: user.phone } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          phone: `deleted:${userId}`,
          name: null,
          email: null,
          avatarKey: null,
          blockedReason: null,
          status: 'deleted',
        },
      }),
    ]);
    await this.audit.log(userId, 'user.delete', 'user', userId);
    const keys = documents.map((d) => d.storageKey);
    if (user.avatarKey) keys.push(user.avatarKey);
    await this.removeQuietly(keys);
    return { message: 'Account deleted' };
  }

  // Profile reads must keep working when storage is unreachable.
  private async avatarUrl(key: string | null) {
    if (!key) return null;
    try {
      return await this.storage.createSignedUrl(key, AVATAR_URL_SECONDS);
    } catch (error) {
      this.logger.warn(`Could not sign avatar URL: ${String(error)}`);
      return null;
    }
  }

  private async removeQuietly(keys: string[]) {
    try {
      await this.storage.remove(keys);
    } catch (error) {
      this.logger.warn(
        `Could not delete ${keys.length} file(s): ${String(error)}`,
      );
    }
  }
}
