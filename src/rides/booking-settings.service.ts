import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { BookingSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateBookingSettingsDto } from './dto/booking-settings.dto.js';

// Ride Later rules (BookingSettings row 1), cached briefly since every
// booking view and the sweeper read them.
@Injectable()
export class BookingSettingsService {
  private cached?: { at: number; value: BookingSettings };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<BookingSettings> {
    if (this.cached && Date.now() - this.cached.at < 30_000) {
      return this.cached.value;
    }
    const value =
      (await this.prisma.bookingSettings.findUnique({ where: { id: 1 } })) ??
      (await this.prisma.bookingSettings.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      }));
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(adminId: string, dto: UpdateBookingSettingsDto) {
    const changes: Partial<BookingSettings> = JSON.parse(JSON.stringify(dto));
    const next = { ...(await this.get()), ...changes };
    for (const kind of ['ride', 'freight', 'intercity'] as const) {
      if (next[`${kind}WarnSecond`] >= next[`${kind}WarnFirst`]) {
        throw new BadRequestException(
          `The second warning (${kind}) must come after the first one`,
        );
      }
    }
    const updated = await this.prisma.bookingSettings.update({
      where: { id: 1 },
      data: dto,
    });
    this.cached = undefined;
    await this.audit.log(
      adminId,
      'booking.settings.update',
      'booking_settings',
      '1',
      JSON.parse(JSON.stringify(dto)),
    );
    return updated;
  }
}
