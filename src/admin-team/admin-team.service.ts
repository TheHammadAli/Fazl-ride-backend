import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword, verifyPassword } from '../common/password.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddTeamMemberDto, TeamRole } from './admin-team.dto.js';
import { temporaryPassword } from './temporary-password.js';

const ADMIN_ROLES: Role[] = [Role.admin, Role.super_admin];

// Accounts made here have no phone; `phone` is required and unique.
const emailPhone = (email: string) => `email:${email}`;

// The web admin team (super admins only): add people with a temporary
// password, change their role, reset a password, remove access.
@Injectable()
export class AdminTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      where: { roles: { some: { role: { in: ADMIN_ROLES } } } },
      include: { roles: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        // Admins made from SUPER_ADMIN_PHONES sign in to the app by OTP.
        phone: u.phone.startsWith('email:') ? null : u.phone,
        role: u.roles.some((r) => r.role === Role.super_admin)
          ? 'super_admin'
          : 'admin',
        canSignInToPanel: !!u.passwordHash && !!u.email,
        mustChangePassword: u.mustChangePassword,
        lastLoginAt: u.lastAdminLoginAt,
        createdAt: u.createdAt,
      })),
    };
  }

  // A new admin (or an existing account given panel access). The temporary
  // password is returned once and never stored in plain text.
  async add(actorId: string, dto: AddTeamMemberDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    if (existing?.roles.some((r) => ADMIN_ROLES.includes(r.role))) {
      throw new ConflictException(`${email} is already on the team`);
    }
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name: existing.name ?? dto.name.trim(),
              passwordHash,
              mustChangePassword: true,
              // Access removed earlier: welcome back.
              ...(existing.phone === emailPhone(email) && {
                status: 'active' as const,
                blockedReason: null,
              }),
            },
          })
        : await tx.user.create({
            data: {
              phone: emailPhone(email),
              email,
              name: dto.name.trim(),
              passwordHash,
              mustChangePassword: true,
            },
          });
      await tx.userRole.createMany({
        data: this.rolesFor(dto.role).map((role) => ({ userId: u.id, role })),
        skipDuplicates: true,
      });
      return u;
    });
    await this.audit.log(actorId, 'admin_team.add', 'user', user.id, {
      email,
      role: dto.role,
    });
    return { id: user.id, email, role: dto.role, temporaryPassword: password };
  }

  async changeRole(actorId: string, id: string, role: TeamRole) {
    if (id === actorId) {
      throw new BadRequestException('You cannot change your own role');
    }
    const member = await this.member(id);
    if (role === 'admin' && member.isSuper) await this.assertAnotherSuper(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: id, role: { in: ADMIN_ROLES } },
      });
      await tx.userRole.createMany({
        data: this.rolesFor(role).map((r) => ({ userId: id, role: r })),
      });
    });
    await this.audit.log(actorId, 'admin_team.role', 'user', id, { role });
    return { id, role };
  }

  // A forgotten password: a new temporary one, every session signed out.
  async resetPassword(actorId: string, id: string) {
    const member = await this.member(id);
    if (!member.user.email) {
      throw new BadRequestException(
        'This admin signs in with a phone, not a panel password',
      );
    }
    const password = temporaryPassword();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      }),
      this.revokeSessions(id),
    ]);
    await this.audit.log(actorId, 'admin_team.reset_password', 'user', id);
    return { id, temporaryPassword: password };
  }

  // Takes the admin roles away and signs them out. An account made only for
  // the panel is also blocked; someone who also uses the app keeps that.
  async remove(actorId: string, id: string) {
    if (id === actorId) {
      throw new BadRequestException('You cannot remove yourself');
    }
    const member = await this.member(id);
    if (member.isSuper) await this.assertAnotherSuper(id);
    const panelOnly = member.user.phone.startsWith('email:');
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({
        where: { userId: id, role: { in: ADMIN_ROLES } },
      }),
      this.revokeSessions(id),
      ...(panelOnly
        ? [
            this.prisma.user.update({
              where: { id },
              data: {
                status: 'blocked',
                blockedReason: 'Admin access removed',
              },
            }),
          ]
        : []),
    ]);
    await this.audit.log(actorId, 'admin_team.remove', 'user', id, {
      email: member.user.email,
    });
    return { removed: true };
  }

  // Any admin: their own password (also the forced change after a
  // temporary one).
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new BadRequestException('This account has no panel password');
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException('The current password is wrong');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'Choose a password different from the old one',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      },
    });
    await this.audit.log(userId, 'admin.password_change', 'user', userId);
    return { changed: true };
  }

  private rolesFor(role: TeamRole): Role[] {
    return role === 'super_admin'
      ? [Role.admin, Role.super_admin]
      : [Role.admin];
  }

  private revokeSessions(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async member(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    const roles = user?.roles.map((r) => r.role) ?? [];
    if (!user || !roles.some((r) => ADMIN_ROLES.includes(r))) {
      throw new NotFoundException('Team member not found');
    }
    return { user, isSuper: roles.includes(Role.super_admin) };
  }

  // There must always be someone who can manage the team.
  private async assertAnotherSuper(exceptId: string) {
    const others = await this.prisma.userRole.count({
      where: {
        role: Role.super_admin,
        userId: { not: exceptId },
        user: { status: 'active' },
      },
    });
    if (others === 0) {
      throw new BadRequestException('There must be at least one super admin');
    }
  }
}
