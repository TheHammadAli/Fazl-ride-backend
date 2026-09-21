import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      avatarUrl: user.avatarUrl,
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
}
