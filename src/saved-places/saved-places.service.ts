import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SavePlaceDto } from './saved-places.dto.js';

const MAX_PLACES = 20;

// Places a customer keeps (Home, Work, their own) to book in one tap.
// Home and Work are one each: saving again moves them.
@Injectable()
export class SavedPlacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const places = await this.prisma.savedPlace.findMany({
      where: { userId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: places.map((p) => this.present(p)) };
  }

  async save(userId: string, dto: SavePlaceDto) {
    const data = {
      kind: dto.kind,
      label:
        dto.label?.trim() ||
        (dto.kind === 'home' ? 'Home' : dto.kind === 'work' ? 'Work' : 'Saved'),
      lat: dto.lat,
      lng: dto.lng,
      address: dto.address,
    };
    if (dto.kind !== 'other') {
      const existing = await this.prisma.savedPlace.findFirst({
        where: { userId, kind: dto.kind },
      });
      if (existing) {
        return this.present(
          await this.prisma.savedPlace.update({
            where: { id: existing.id },
            data,
          }),
        );
      }
    }
    const count = await this.prisma.savedPlace.count({ where: { userId } });
    if (count >= MAX_PLACES) {
      throw new ConflictException(`You can save up to ${MAX_PLACES} places`);
    }
    return this.present(
      await this.prisma.savedPlace.create({ data: { userId, ...data } }),
    );
  }

  async remove(userId: string, id: string) {
    const done = await this.prisma.savedPlace.deleteMany({
      where: { id, userId },
    });
    if (!done.count) throw new NotFoundException('Place not found');
    return { message: 'Place removed' };
  }

  private present(p: {
    id: string;
    kind: string;
    label: string;
    lat: number;
    lng: number;
    address: string;
  }) {
    return {
      id: p.id,
      kind: p.kind,
      label: p.label,
      lat: p.lat,
      lng: p.lng,
      address: p.address,
    };
  }
}
