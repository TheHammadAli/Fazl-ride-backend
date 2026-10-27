import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { RideStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  discountFor,
  normalizeCode,
  PROMO_MESSAGES,
  promoProblem,
  type PromoProblem,
} from './promo-rules.js';
import type {
  CheckPromoDto,
  CreatePromoDto,
  ListPromosDto,
  UpdatePromoDto,
} from './promos.dto.js';

type Tx = Prisma.TransactionClient;

// A reserved code counts only while its ride can still finish.
const OPEN: RideStatus[] = [
  'scheduled',
  'requested',
  'accepted',
  'arrived',
  'started',
];

// Promo codes: admins create them, passengers enter one when requesting, the
// discount comes off the final fare at completion.
@Injectable()
export class PromosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private refuse(problem: PromoProblem): never {
    throw new BadRequestException({
      code: problem,
      message: PROMO_MESSAGES[problem],
    });
  }

  private usesWhere(promoId: string): Prisma.PromoRedemptionWhereInput {
    return {
      promoId,
      OR: [
        { status: 'used' },
        { status: 'reserved', ride: { status: { in: OPEN } } },
      ],
    };
  }

  private async problemFor(
    db: Tx | PrismaService,
    promo: Prisma.PromoCodeGetPayload<object>,
    userId: string,
    service: string,
    fare?: number,
  ) {
    const [totalUses, userUses, completedTrips] = await Promise.all([
      db.promoRedemption.count({ where: this.usesWhere(promo.id) }),
      db.promoRedemption.count({
        where: { ...this.usesWhere(promo.id), userId },
      }),
      db.ride.count({ where: { passengerId: userId, status: 'completed' } }),
    ]);
    return promoProblem(
      promo,
      { now: new Date(), service, totalUses, userUses, completedTrips },
      fare,
    );
  }

  // The app's "Apply" button: is the code good for this trip, and how much
  // comes off the price shown.
  async check(userId: string, dto: CheckPromoDto) {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: normalizeCode(dto.code) },
    });
    if (!promo) this.refuse('PROMO_INACTIVE');
    const problem = await this.problemFor(
      this.prisma,
      promo,
      userId,
      dto.service ?? 'ride',
      dto.fare,
    );
    if (problem) this.refuse(problem);
    return {
      code: promo.code,
      description: promo.description,
      discountType: promo.discountType,
      value: promo.value,
      maxDiscount: promo.maxDiscount,
      minFare: promo.minFare,
      discount: dto.fare != null ? discountFor(promo, dto.fare) : null,
    };
  }

  // Inside the ride-creation transaction: the code is held for this ride.
  // The promo row is locked so two people cannot take the last use at once.
  async reserve(
    tx: Tx,
    args: {
      userId: string;
      rideId: string;
      code: string;
      service: string;
      fare: number;
    },
  ) {
    const code = normalizeCode(args.code);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM promo_codes WHERE "code" = ${code} FOR UPDATE`;
    if (!locked.length) this.refuse('PROMO_INACTIVE');
    const promo = await tx.promoCode.findUniqueOrThrow({
      where: { id: locked[0].id },
    });
    const problem = await this.problemFor(
      tx,
      promo,
      args.userId,
      args.service,
      args.fare,
    );
    if (problem) this.refuse(problem);
    await tx.promoRedemption.create({
      data: { promoId: promo.id, userId: args.userId, rideId: args.rideId },
    });
    return { code: promo.code, estimate: discountFor(promo, args.fare) };
  }

  // Inside the ride-completion transaction: the discount on the final fare
  // (0 when it fell below the minimum). Returns 0 for a ride without a code.
  async redeem(tx: Tx, rideId: string, fare: number) {
    const held = await tx.promoRedemption.findUnique({
      where: { rideId },
      include: { promo: true },
    });
    if (!held || held.status !== 'reserved') return held?.discount ?? 0;
    const discount = discountFor(held.promo, fare);
    await tx.promoRedemption.update({
      where: { id: held.id },
      data: { status: 'used', discount },
    });
    return discount;
  }

  // The code on a ride for the ride view, with what it is expected to take
  // off before the ride is finished.
  async forRide(rideId: string) {
    const held = await this.prisma.promoRedemption.findUnique({
      where: { rideId },
      include: { promo: { select: { code: true } } },
    });
    return held ? { code: held.promo.code, status: held.status } : null;
  }

  // ---- Admin ----

  async list(query: ListPromosDto) {
    const where: Prisma.PromoCodeWhereInput = {
      ...(query.search && {
        code: { contains: query.search.trim(), mode: 'insensitive' },
      }),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.promoCode.count({ where }),
    ]);
    const ids = items.map((p) => p.id);
    const [used, open] = await Promise.all([
      this.prisma.promoRedemption.groupBy({
        by: ['promoId'],
        where: { promoId: { in: ids }, status: 'used' },
        _count: true,
        _sum: { discount: true },
      }),
      this.prisma.promoRedemption.groupBy({
        by: ['promoId'],
        where: {
          promoId: { in: ids },
          status: 'reserved',
          ride: { status: { in: OPEN } },
        },
        _count: true,
      }),
    ]);
    const now = new Date();
    return {
      items: items.map((p) => {
        const u = used.find((x) => x.promoId === p.id);
        const o = open.find((x) => x.promoId === p.id);
        return {
          ...p,
          usedCount: u?._count ?? 0,
          openCount: o?._count ?? 0,
          totalDiscount: u?._sum.discount ?? 0,
          state: !p.active
            ? 'paused'
            : p.expiresAt && p.expiresAt <= now
              ? 'expired'
              : p.startsAt && p.startsAt > now
                ? 'scheduled'
                : p.usageLimit != null &&
                    (u?._count ?? 0) + (o?._count ?? 0) >= p.usageLimit
                  ? 'used_up'
                  : 'live',
        };
      }),
      total,
      page,
      limit,
    };
  }

  async create(adminId: string, dto: CreatePromoDto) {
    this.assertTerms(dto);
    const code = normalizeCode(dto.code);
    const clash = await this.prisma.promoCode.findUnique({ where: { code } });
    if (clash) throw new ConflictException(`${code} already exists`);
    const promo = await this.prisma.promoCode.create({
      data: {
        code,
        description: dto.description?.trim() || null,
        discountType: dto.discountType,
        value: dto.value,
        maxDiscount: dto.maxDiscount ?? null,
        minFare: dto.minFare ?? 0,
        service: dto.service ?? null,
        firstRideOnly: dto.firstRideOnly ?? false,
        usageLimit: dto.usageLimit ?? null,
        perUserLimit: dto.perUserLimit ?? 1,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        active: dto.active ?? true,
        createdById: adminId,
      },
    });
    await this.audit.log(
      adminId,
      'promo.create',
      'promo_code',
      promo.id,
      JSON.parse(JSON.stringify(dto)),
    );
    return promo;
  }

  // The code itself and how the discount is worked out cannot change once
  // someone used it; limits, dates and on/off always can.
  async update(adminId: string, id: string, dto: UpdatePromoDto) {
    const current = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Promo code not found');
    const termsChange =
      dto.code !== undefined ||
      dto.discountType !== undefined ||
      dto.value !== undefined ||
      dto.maxDiscount !== undefined;
    if (termsChange) {
      const uses = await this.prisma.promoRedemption.count({
        where: { promoId: id },
      });
      if (uses > 0) {
        throw new ConflictException(
          'This code has been used; create a new code to change its discount',
        );
      }
    }
    const merged = {
      discountType: dto.discountType ?? current.discountType,
      value: dto.value ?? current.value,
      startsAt:
        dto.startsAt !== undefined
          ? dto.startsAt
          : current.startsAt?.toISOString(),
      expiresAt:
        dto.expiresAt !== undefined
          ? dto.expiresAt
          : current.expiresAt?.toISOString(),
    };
    this.assertTerms(merged);
    const code = dto.code !== undefined ? normalizeCode(dto.code) : undefined;
    if (code && code !== current.code) {
      const clash = await this.prisma.promoCode.findUnique({ where: { code } });
      if (clash) throw new ConflictException(`${code} already exists`);
    }
    const date = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(v) : null;
    const promo = await this.prisma.promoCode.update({
      where: { id },
      data: {
        code,
        description:
          dto.description !== undefined
            ? dto.description?.trim() || null
            : undefined,
        discountType: dto.discountType,
        value: dto.value,
        maxDiscount: dto.maxDiscount,
        minFare: dto.minFare,
        service: dto.service,
        firstRideOnly: dto.firstRideOnly,
        usageLimit: dto.usageLimit,
        perUserLimit: dto.perUserLimit,
        startsAt: date(dto.startsAt),
        expiresAt: date(dto.expiresAt),
        active: dto.active,
      },
    });
    await this.audit.log(
      adminId,
      'promo.update',
      'promo_code',
      id,
      JSON.parse(JSON.stringify(dto)),
    );
    return promo;
  }

  // Only a code nobody used can be deleted; otherwise pause it.
  async remove(adminId: string, id: string) {
    const current = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Promo code not found');
    const uses = await this.prisma.promoRedemption.count({
      where: { promoId: id },
    });
    if (uses > 0) {
      throw new ConflictException(
        'This code has been used, so it stays in the records. Pause it instead',
      );
    }
    await this.prisma.promoCode.delete({ where: { id } });
    await this.audit.log(adminId, 'promo.delete', 'promo_code', id, {
      code: current.code,
    });
    return { deleted: true };
  }

  private assertTerms(t: {
    discountType?: string;
    value?: number;
    startsAt?: string | null;
    expiresAt?: string | null;
  }) {
    if (t.discountType === 'percent' && (t.value ?? 0) > 100) {
      throw new BadRequestException('A percentage discount is at most 100');
    }
    if (
      t.startsAt &&
      t.expiresAt &&
      new Date(t.expiresAt) <= new Date(t.startsAt)
    ) {
      throw new BadRequestException('The end date must be after the start');
    }
  }
}
