import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AdjustWalletDto,
  AdminRequestsQueryDto,
  AdminWalletsQueryDto,
  UpdateWalletSettingsDto,
} from './dto/wallet.dto.js';
import { duesToClear, hasDues } from './wallet-rules.js';
import { WalletService } from './wallet.service.js';

const userSelect = { id: true, name: true, phone: true } as const;

// Admin side of wallets: checking top-ups, paying out withdrawals, manual
// corrections and the wallet rules. Every action is written to the audit log.
@Injectable()
export class AdminWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  // Numbers for the top of the admin's wallet page.
  async overview() {
    const settings = await this.wallet.settings();
    const [topups, withdrawals, positive, dues] = await Promise.all([
      this.prisma.walletRequest.aggregate({
        where: { kind: 'topup', status: 'pending' },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.walletRequest.aggregate({
        where: { kind: 'withdrawal', status: 'pending' },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.wallet.aggregate({
        where: { balance: { gt: 0 } },
        _sum: { balance: true },
      }),
      this.prisma.wallet.aggregate({
        where: { balance: { lt: settings.driverMinBalance } },
        _count: true,
        _sum: { balance: true },
      }),
    ]);
    return {
      currency: 'PKR',
      pendingTopups: { count: topups._count, amount: topups._sum.amount ?? 0 },
      pendingWithdrawals: {
        count: withdrawals._count,
        amount: withdrawals._sum.amount ?? 0,
      },
      // What the platform owes people (money sitting in wallets).
      totalBalances: positive._sum.balance ?? 0,
      // Drivers who cannot go online until they top up.
      driversWithDues: { count: dues._count, balance: dues._sum.balance ?? 0 },
      settings,
    };
  }

  async requests(query: AdminRequestsQueryDto) {
    const limit = query.limit ?? 20;
    const before = decodeCursor(query.cursor);
    const rows = await this.prisma.walletRequest.findMany({
      where: {
        ...(query.kind && { kind: query.kind }),
        ...(query.status && { status: query.status }),
        ...(before && {
          OR: [
            { createdAt: { lt: before.at } },
            { createdAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      include: { user: { select: userSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(
        page.map(async (r) => ({
          ...this.wallet.presentRequest(r),
          user: r.user,
          proofUrl: await this.wallet.signed(r.proofKey),
          balance: await this.wallet.balanceOf(r.userId),
        })),
      ),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  // Top-up: the transfer was found, so the money goes in. Withdrawal: the
  // money was sent (it was already held when asked for).
  async approve(adminId: string, requestId: string, reference?: string) {
    const request = await this.findRequest(requestId);
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.walletRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: 'approved',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          ...(request.kind === 'withdrawal' &&
            reference && { reference: reference.trim() }),
        },
      });
      if (done.count === 0) {
        throw new ConflictException('This request is no longer pending');
      }
      if (request.kind === 'topup') {
        await this.wallet.post(tx, {
          userId: request.userId,
          type: 'topup',
          amount: request.amount,
          key: `request:${request.id}:credit`,
          requestId: request.id,
          note: `${request.method} ${request.reference ?? ''}`.trim(),
          actorId: adminId,
        });
      }
    });
    await this.audit.log(
      adminId,
      `wallet.${request.kind}.approve`,
      'wallet_request',
      requestId,
      { userId: request.userId, amount: request.amount, reference },
    );
    this.wallet.notify(request.userId);
    return this.wallet.presentRequest(await this.findRequest(requestId));
  }

  async reject(adminId: string, requestId: string, reason: string) {
    const request = await this.findRequest(requestId);
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.walletRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: 'rejected',
          reviewedBy: adminId,
          reviewedAt: new Date(),
          rejectReason: reason.trim(),
        },
      });
      if (done.count === 0) {
        throw new ConflictException('This request is no longer pending');
      }
      if (request.kind === 'withdrawal') {
        await this.wallet.release(tx, request, adminId);
      }
    });
    await this.audit.log(
      adminId,
      `wallet.${request.kind}.reject`,
      'wallet_request',
      requestId,
      { userId: request.userId, amount: request.amount, reason },
    );
    this.wallet.notify(request.userId);
    return this.wallet.presentRequest(await this.findRequest(requestId));
  }

  async wallets(query: AdminWalletsQueryDto) {
    const limit = query.limit ?? 20;
    const settings = await this.wallet.settings();
    const before = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const where: Prisma.WalletWhereInput = {
      ...(query.dues === 'true' && {
        balance: { lt: settings.driverMinBalance },
      }),
      ...(search && {
        user: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        },
      }),
      ...(before && {
        OR: [
          { updatedAt: { lt: before.at } },
          { updatedAt: before.at, userId: { lt: before.id } },
        ],
      }),
    };
    const rows = await this.prisma.wallet.findMany({
      where,
      include: {
        user: { select: { ...userSelect, roles: { select: { role: true } } } },
      },
      orderBy: [{ updatedAt: 'desc' }, { userId: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((w) => ({
        userId: w.userId,
        name: w.user.name,
        phone: w.user.phone,
        roles: w.user.roles.map((r) => r.role),
        balance: w.balance,
        hasDues: hasDues(w.balance, settings.driverMinBalance),
        updatedAt: w.updatedAt,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.updatedAt, last.userId)
          : null,
    };
  }

  async walletOf(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    const [settings, balance, transactions] = await Promise.all([
      this.wallet.settings(),
      this.wallet.balanceOf(userId),
      this.wallet.transactions(userId, { limit: 50 }),
    ]);
    return {
      user,
      currency: 'PKR',
      balance,
      hasDues: hasDues(balance, settings.driverMinBalance),
      duesToClear: duesToClear(balance, settings.driverMinBalance),
      transactions: transactions.items,
    };
  }

  // A correction or a refund, always with a reason. Taking money away may
  // leave a driver negative but is refused for a balance that would go
  // below zero otherwise (so a mistaken debit is visible, not silent).
  async adjust(adminId: string, userId: string, dto: AdjustWalletDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (dto.type === 'refund' && dto.amount < 0) {
      throw new BadRequestException('A refund adds money to the wallet');
    }
    const key = `admin:${adminId}:${Date.now()}:${userId}`;
    const balance = await this.prisma.$transaction((tx) =>
      this.wallet.post(tx, {
        userId,
        type: dto.type,
        amount: dto.amount,
        key,
        note: dto.note.trim(),
        actorId: adminId,
      }),
    );
    await this.audit.log(adminId, 'wallet.adjust', 'wallet', userId, {
      amount: dto.amount,
      type: dto.type,
      note: dto.note,
    });
    this.wallet.notify(userId);
    return { userId, balance };
  }

  async updateSettings(adminId: string, dto: UpdateWalletSettingsDto) {
    const current = await this.wallet.settings();
    const minTopup = dto.minTopup ?? current.minTopup;
    const maxTopup = dto.maxTopup ?? current.maxTopup;
    if (minTopup > maxTopup) {
      throw new BadRequestException(
        'The minimum top-up can not be more than the maximum',
      );
    }
    const updated = await this.prisma.walletSettings.update({
      where: { id: 1 },
      data: dto,
    });
    await this.audit.log(
      adminId,
      'wallet.settings.update',
      'wallet_settings',
      '1',
      JSON.parse(JSON.stringify(dto)),
    );
    return updated;
  }

  private async findRequest(id: string) {
    const request = await this.prisma.walletRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }
}
