import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateAppSettingsDto } from './app-settings.dto.js';

const ROW = 1;

// Support contacts and legal links: admins edit them, the apps read them.
@Injectable()
export class AppSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async row() {
    return this.prisma.appSettings.upsert({
      where: { id: ROW },
      create: { id: ROW },
      update: {},
    });
  }

  // What the apps get (GET config): no login needed, so the login screen and
  // a signed-out person can still reach support and the legal pages.
  async publicConfig() {
    const s = await this.row();
    return {
      support: {
        phone: s.supportPhone,
        whatsapp: s.supportWhatsapp,
        email: s.supportEmail,
        hours: s.supportHours,
      },
      links: { privacy: s.privacyUrl, terms: s.termsUrl },
    };
  }

  async get() {
    const { id: _id, ...rest } = await this.row();
    return rest;
  }

  async update(adminId: string, dto: UpdateAppSettingsDto) {
    await this.row();
    const updated = await this.prisma.appSettings.update({
      where: { id: ROW },
      data: dto,
    });
    await this.audit.log(
      adminId,
      'app_settings.update',
      'app_settings',
      String(ROW),
      JSON.parse(JSON.stringify(dto)),
    );
    const { id: _id, ...rest } = updated;
    return rest;
  }
}
