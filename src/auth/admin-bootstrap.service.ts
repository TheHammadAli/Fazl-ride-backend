import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../generated/prisma/enums.js';
import { hashPassword, verifyPassword } from '../common/password.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MIN_PASSWORD_LENGTH = 10;

// Creates the first web-admin account from two env variables, so there is a
// way in before any admin exists (a password cannot be set through the app).
// Runs on every start and is safe to repeat: if the account already has this
// exact password nothing changes. Changing ADMIN_BOOTSTRAP_PASSWORD resets it.
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const email = this.config
      .get<string>('ADMIN_BOOTSTRAP_EMAIL')
      ?.trim()
      .toLowerCase();
    const password = this.config.get<string>('ADMIN_BOOTSTRAP_PASSWORD');
    if (!email || !password) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      this.logger.error(
        `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters; admin account not created`,
      );
      return;
    }

    try {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      const unchanged =
        existing?.passwordHash &&
        (await verifyPassword(password, existing.passwordHash));
      if (!unchanged) {
        const passwordHash = await hashPassword(password);
        const user = existing
          ? await this.prisma.user.update({
              where: { id: existing.id },
              data: { passwordHash },
            })
          : await this.prisma.user.create({
              // `phone` is required and unique but this account never uses one.
              data: {
                phone: `email:${email}`,
                email,
                name: 'Administrator',
                passwordHash,
              },
            });
        this.logger.warn(
          `Web admin account ${email} ${existing ? 'password reset' : 'created'} from ADMIN_BOOTSTRAP_*`,
        );
        await this.ensureRole(user.id);
        return;
      }
      await this.ensureRole(existing.id);
    } catch (err) {
      // A database that is briefly down must not stop the API from starting.
      this.logger.error(
        `Could not set up the bootstrap admin: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private ensureRole(userId: string) {
    return this.prisma.userRole.upsert({
      where: { userId_role: { userId, role: Role.super_admin } },
      update: {},
      create: { userId, role: Role.super_admin },
    });
  }
}
