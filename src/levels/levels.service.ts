import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { AuditService } from '../audit/audit.service.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { DriverLevel } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type {
  CreateDriverLevelDto,
  UpdateDriverLevelDto,
} from './dto/driver-level.dto.js';
import { levelFor, newlyReached, nextLevel, progress } from './level-rules.js';

const CACHE_MS = 30_000;

// Driver achievement levels: lifetime completed trips decide the level, a
// new level pays its bonus once and is announced, and its rewards apply
// (commission discount and dues limit in WalletService, priority in
// MatchingService).
@Injectable()
export class LevelsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LevelsService.name);
  private cache?: { at: number; levels: DriverLevel[] };
  private subscription?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.subscription = this.events
      .on<{ driverId: string }>('ride.completed')
      .subscribe(({ payload }) => {
        void this.recheck(payload.driverId).catch((e) =>
          this.logger.warn(`Level check failed: ${String(e)}`),
        );
      });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  async levels(): Promise<DriverLevel[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.levels;
    }
    const levels = await this.prisma.driverLevel.findMany({
      orderBy: { minRides: 'asc' },
    });
    this.cache = { at: Date.now(), levels };
    return levels;
  }

  tripsOf(driverId: string) {
    return this.prisma.ride.count({
      where: { driverId, status: 'completed' },
    });
  }

  // For the driver's profile: trips, level, progress and every level's
  // rewards.
  async summary(driverId: string) {
    await this.recheck(driverId);
    const [trips, levels] = await Promise.all([
      this.tripsOf(driverId),
      this.levels(),
    ]);
    const current = levelFor(trips, levels);
    const next = nextLevel(trips, levels);
    return {
      trips,
      current: current ? this.present(current) : null,
      next: next ? this.present(next) : null,
      progress: progress(trips, current, next),
      levels: levels.filter((l) => l.active).map((l) => this.present(l)),
    };
  }

  // After a completed trip (and when the profile is opened): a new level is
  // saved, each newly reached level pays its bonus once, and is announced.
  async recheck(driverId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { id: true, levelKey: true },
    });
    if (!profile) return;
    const [trips, levels] = await Promise.all([
      this.tripsOf(driverId),
      this.levels(),
    ]);
    const reached = newlyReached(profile.levelKey, trips, levels);
    if (!reached.length) return;
    const top = reached.at(-1)!;
    const moved = await this.prisma.$transaction(async (tx) => {
      const done = await tx.driverProfile.updateMany({
        where: { id: profile.id, levelKey: profile.levelKey },
        data: { levelKey: top.key },
      });
      if (!done.count) return false;
      for (const level of reached) {
        if (level.bonus <= 0) continue;
        await this.wallet.post(tx, {
          userId: driverId,
          type: 'level_bonus',
          amount: level.bonus,
          key: `level:${level.key}:${driverId}`,
          note: `${level.name} level`,
          allowNegative: true,
        });
      }
      return true;
    });
    if (!moved) return;
    const bonus = reached.reduce((sum, l) => sum + Math.max(0, l.bonus), 0);
    if (bonus > 0) this.wallet.notify(driverId);
    this.events.emit('driver.level_up', {
      userId: driverId,
      levelKey: top.key,
      name: top.name,
      bonus,
    });
  }

  // Priority for choosing who gets a request: metres closer, per driver.
  async priorityFor(userIds: string[]): Promise<Map<string, number>> {
    if (!userIds.length) return new Map();
    const levels = await this.levels();
    const profiles = await this.prisma.driverProfile.findMany({
      where: { userId: { in: userIds }, levelKey: { not: null } },
      select: { userId: true, levelKey: true },
    });
    const map = new Map<string, number>();
    for (const p of profiles) {
      const level = levels.find((l) => l.key === p.levelKey && l.active);
      if (level?.priorityMeters) map.set(p.userId, level.priorityMeters);
    }
    return map;
  }

  // ---- Admin ----

  async listAll() {
    return this.prisma.driverLevel.findMany({ orderBy: { minRides: 'asc' } });
  }

  async create(dto: CreateDriverLevelDto, actorId: string) {
    const exists = await this.prisma.driverLevel.findUnique({
      where: { key: dto.key },
    });
    if (exists)
      throw new ConflictException(`Level "${dto.key}" already exists`);
    const created = await this.prisma.driverLevel.create({
      data: {
        ...this.clean(dto),
        key: dto.key,
        name: dto.name,
        minRides: dto.minRides,
      },
    });
    this.cache = undefined;
    await this.audit.log(
      actorId,
      'driver_level.create',
      'driver_level',
      dto.key,
      JSON.parse(JSON.stringify(dto)),
    );
    return created;
  }

  async update(key: string, dto: UpdateDriverLevelDto, actorId: string) {
    const existing = await this.prisma.driverLevel.findUnique({
      where: { key },
    });
    if (!existing) throw new NotFoundException('Level not found');
    const updated = await this.prisma.driverLevel.update({
      where: { key },
      data: this.clean(dto),
    });
    this.cache = undefined;
    await this.audit.log(
      actorId,
      'driver_level.update',
      'driver_level',
      key,
      JSON.parse(JSON.stringify(dto)),
    );
    return updated;
  }

  // A plain copy of what was sent, perks trimmed.
  private clean(dto: UpdateDriverLevelDto) {
    const data: Record<string, unknown> = JSON.parse(JSON.stringify(dto));
    delete data.key;
    if (dto.perks) {
      data.perks = dto.perks.map((p) => p.trim()).filter(Boolean);
    }
    if (dto.minBalance === null) data.minBalance = null;
    return data;
  }

  present(l: DriverLevel) {
    return {
      key: l.key,
      name: l.name,
      minRides: l.minRides,
      color: l.color,
      icon: l.icon,
      rewards: {
        commissionDiscount: l.commissionDiscount,
        bonus: l.bonus,
        priority: l.priorityMeters > 0,
        minBalance: l.minBalance,
        perks: l.perks,
      },
    };
  }
}
