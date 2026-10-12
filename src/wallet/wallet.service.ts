import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { detectFileType } from '../common/file-type.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type {
  Prisma,
  WalletRequest,
  WalletSettings,
  WalletTransaction,
} from '../generated/prisma/client.js';
import type {
  PaymentMethod,
  WalletTransactionType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type {
  AddChangeDto,
  TopupRequestDto,
  WithdrawalRequestDto,
} from './dto/wallet.dto.js';
import {
  commissionFor,
  duesToClear,
  hasDues,
  splitPayment,
} from './wallet-rules.js';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

// Open requests one person may have at a time, per kind.
const MAX_PENDING_REQUESTS = 3;

// How long after a ride the driver can still put the change into the wallet.
const CHANGE_WINDOW_MS = 2 * 60 * 60 * 1000;

export const TRANSACTION_LABELS: Record<WalletTransactionType, string> = {
  topup: 'Top up',
  ride_payment: 'Ride payment',
  ride_earning: 'Ride paid by wallet',
  commission: 'Commission',
  change_sent: 'Change to passenger',
  change_received: 'Change from driver',
  withdrawal: 'Withdrawal',
  withdrawal_reversal: 'Withdrawal returned',
  adjustment: 'Adjustment',
  refund: 'Refund',
};

// One posting to the ledger. `key` must be unique for the business event it
// records, so the same thing is never applied twice (retries, double taps).
export interface Posting {
  userId: string;
  type: WalletTransactionType;
  amount: number;
  key: string;
  rideId?: string;
  requestId?: string;
  note?: string;
  actorId?: string;
  // Drivers' balances may go below zero (commission on cash rides).
  allowNegative?: boolean;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: DomainEvents,
    private readonly notifications: AdminNotificationsService,
  ) {}

  // ---- Ledger -------------------------------------------------------------

  // Applies one posting inside the caller's transaction. Returns the new
  // balance, or null when this key was already posted (nothing changes).
  // The balance moves with a single conditional UPDATE, so two postings at
  // the same time can never overspend.
  async post(tx: Tx, p: Posting): Promise<number | null> {
    const created = await tx.walletTransaction.createMany({
      data: [
        {
          userId: p.userId,
          type: p.type,
          amount: p.amount,
          balanceAfter: 0,
          key: p.key,
          rideId: p.rideId,
          requestId: p.requestId,
          note: p.note,
          actorId: p.actorId,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return null;
    await tx.$executeRaw`
      INSERT INTO wallets ("userId", "balance", "updatedAt")
      VALUES (${p.userId}::uuid, 0, now())
      ON CONFLICT ("userId") DO NOTHING`;
    const allowNegative = p.allowNegative ?? false;
    const rows = await tx.$queryRaw<{ balance: number }[]>`
      UPDATE wallets SET "balance" = "balance" + ${p.amount}, "updatedAt" = now()
      WHERE "userId" = ${p.userId}::uuid
        AND (${allowNegative}::boolean OR "balance" + ${p.amount} >= 0)
      RETURNING "balance"`;
    const balance = rows[0]?.balance;
    if (balance == null) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'There is not enough balance in the wallet',
      });
    }
    await tx.walletTransaction.update({
      where: { key: p.key },
      data: { balanceAfter: balance },
    });
    return balance;
  }

  // Tells the apps a balance changed (call after the transaction commits).
  notify(...userIds: string[]) {
    for (const userId of new Set(userIds)) {
      this.events.emit('wallet.changed', { userId });
    }
  }

  async balanceOf(userId: string, tx: Tx = this.prisma): Promise<number> {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    return wallet?.balance ?? 0;
  }

  // ---- Settings -----------------------------------------------------------

  async settings(tx: Tx = this.prisma): Promise<WalletSettings> {
    return (
      (await tx.walletSettings.findUnique({ where: { id: 1 } })) ??
      (await tx.walletSettings.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {},
      }))
    );
  }

  // ---- Rides --------------------------------------------------------------

  // A ride asked to be paid by wallet: allowed when wallet payments are on
  // and there is something in it (whatever it does not cover is cash).
  async assertCanPayByWallet(userId: string) {
    const [settings, balance] = await Promise.all([
      this.settings(),
      this.balanceOf(userId),
    ]);
    if (!settings.walletPaymentsEnabled) {
      throw new BadRequestException('Wallet payments are not available');
    }
    if (balance <= 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Your wallet is empty. Top up or pay by cash.',
      });
    }
  }

  // Called inside the ride-completion transaction: takes the wallet part of
  // the fare from the passenger and gives it to the driver, and takes the
  // platform's commission from the driver. Safe to run twice for one ride.
  async settleRide(
    tx: Tx,
    ride: {
      id: string;
      passengerId: string;
      driverId: string;
      fare: number;
      paymentMethod: PaymentMethod;
    },
  ): Promise<{ walletPaid: number; commission: number }> {
    const settings = await this.settings(tx);
    const commission = commissionFor(ride.fare, settings.commissionPercent);
    let walletPaid = 0;
    if (ride.paymentMethod === 'wallet') {
      const locked = await tx.$queryRaw<{ balance: number }[]>`
        SELECT "balance" FROM wallets WHERE "userId" = ${ride.passengerId}::uuid
        FOR UPDATE`;
      walletPaid = splitPayment(ride.fare, locked[0]?.balance ?? 0).walletPaid;
      if (walletPaid > 0) {
        await this.post(tx, {
          userId: ride.passengerId,
          type: 'ride_payment',
          amount: -walletPaid,
          key: `ride:${ride.id}:payment`,
          rideId: ride.id,
        });
        await this.post(tx, {
          userId: ride.driverId,
          type: 'ride_earning',
          amount: walletPaid,
          key: `ride:${ride.id}:earning`,
          rideId: ride.id,
          allowNegative: true,
        });
      }
    }
    if (commission > 0) {
      await this.post(tx, {
        userId: ride.driverId,
        type: 'commission',
        amount: -commission,
        key: `ride:${ride.id}:commission`,
        rideId: ride.id,
        allowNegative: true,
      });
    }
    return { walletPaid, commission };
  }

  // Driver: the passenger paid more cash than the fare; instead of handing
  // the change back, it goes into the passenger's wallet. Once per ride.
  async addChange(driverId: string, dto: AddChangeDto) {
    const ride = await this.prisma.ride.findFirst({
      where: { id: dto.rideId, driverId },
      select: {
        id: true,
        status: true,
        passengerId: true,
        completedAt: true,
        passenger: { select: { name: true } },
      },
    });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.status !== 'completed' || !ride.completedAt) {
      throw new ConflictException(
        'Change can be added once the ride is complete',
      );
    }
    if (Date.now() - ride.completedAt.getTime() > CHANGE_WINDOW_MS) {
      throw new ConflictException('It is too late to add change for this ride');
    }
    const settings = await this.settings();
    if (dto.amount > settings.maxChange) {
      throw new BadRequestException(
        `Change can be at most Rs ${settings.maxChange}`,
      );
    }
    const added = await this.prisma.$transaction(async (tx) => {
      const sent = await this.post(tx, {
        userId: driverId,
        type: 'change_sent',
        amount: -dto.amount,
        key: `ride:${ride.id}:change-sent`,
        rideId: ride.id,
        allowNegative: true,
      });
      if (sent == null) return false;
      await this.post(tx, {
        userId: ride.passengerId,
        type: 'change_received',
        amount: dto.amount,
        key: `ride:${ride.id}:change-received`,
        rideId: ride.id,
      });
      return true;
    });
    if (!added) {
      throw new ConflictException('Change was already added for this ride');
    }
    this.notify(driverId, ride.passengerId);
    return {
      rideId: ride.id,
      amount: dto.amount,
      passengerName: ride.passenger.name,
      balance: await this.balanceOf(driverId),
    };
  }

  // ---- Driver dues --------------------------------------------------------

  // Going online with commission dues above the limit is refused, with what
  // it takes to clear them.
  async assertNoDues(driverId: string) {
    const [settings, balance] = await Promise.all([
      this.settings(),
      this.balanceOf(driverId),
    ]);
    if (hasDues(balance, settings.driverMinBalance)) {
      throw new ForbiddenException({
        code: 'WALLET_DUES',
        message: `Clear your dues of Rs ${duesToClear(balance, settings.driverMinBalance)} to go online`,
        balance,
        minBalance: settings.driverMinBalance,
        duesToClear: duesToClear(balance, settings.driverMinBalance),
      });
    }
  }

  // Of these drivers, the ones below the minimum balance: they get no new
  // offers until they top up (going online is refused too).
  async withDues(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const settings = await this.settings();
    const rows = await this.prisma.wallet.findMany({
      where: {
        userId: { in: userIds },
        balance: { lt: settings.driverMinBalance },
      },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  // ---- The person's own wallet --------------------------------------------

  async summary(userId: string) {
    const [settings, balance, pending] = await Promise.all([
      this.settings(),
      this.balanceOf(userId),
      this.prisma.walletRequest.findMany({
        where: { userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      currency: 'PKR',
      balance,
      // Drivers: below this they cannot go online.
      minBalance: settings.driverMinBalance,
      hasDues: hasDues(balance, settings.driverMinBalance),
      duesToClear: duesToClear(balance, settings.driverMinBalance),
      limits: {
        minTopup: settings.minTopup,
        maxTopup: settings.maxTopup,
        minWithdrawal: settings.minWithdrawal,
        maxChange: settings.maxChange,
      },
      walletPaymentsEnabled: settings.walletPaymentsEnabled,
      topupInstructions: settings.topupInstructions,
      pendingRequests: pending.map((r) => this.presentRequest(r)),
    };
  }

  async transactions(userId: string, opts: { limit: number; cursor?: string }) {
    const before = decodeCursor(opts.cursor);
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        userId,
        ...(before && {
          OR: [
            { createdAt: { lt: before.at } },
            { createdAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((t) => this.presentTransaction(t)),
      nextCursor:
        rows.length > opts.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  async requests(userId: string, opts: { limit: number; cursor?: string }) {
    const before = decodeCursor(opts.cursor);
    const rows = await this.prisma.walletRequest.findMany({
      where: {
        userId,
        ...(before && {
          OR: [
            { createdAt: { lt: before.at } },
            { createdAt: before.at, id: { lt: before.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.presentRequest(r)),
      nextCursor:
        rows.length > opts.limit && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  // The screenshot of a transfer, stored privately under the person's folder.
  async uploadProof(userId: string, file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A non-empty "file" is required');
    }
    const detected = detectFileType(file.buffer);
    if (!detected || detected.mime === 'application/pdf') {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP screenshots are allowed',
      );
    }
    const key = `wallet/${userId}/${randomUUID()}.${detected.ext}`;
    await this.storage.upload(key, file.buffer, detected.mime);
    return { key, url: await this.signed(key) };
  }

  // A top-up paid outside the app, waiting for an admin to check it.
  async requestTopup(userId: string, dto: TopupRequestDto) {
    const settings = await this.settings();
    if (dto.amount < settings.minTopup || dto.amount > settings.maxTopup) {
      throw new BadRequestException(
        `A top-up must be between Rs ${settings.minTopup} and Rs ${settings.maxTopup}`,
      );
    }
    if (dto.proofKey && !dto.proofKey.startsWith(`wallet/${userId}/`)) {
      throw new BadRequestException('Unknown screenshot');
    }
    await this.assertFewPending(userId, 'topup');
    const reference = dto.reference.trim();
    const duplicate = await this.prisma.walletRequest.findFirst({
      where: {
        kind: 'topup',
        method: dto.method,
        reference,
        status: { in: ['pending', 'approved'] },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'A top-up with this transaction id was already sent',
      );
    }
    const request = await this.prisma.walletRequest.create({
      data: {
        userId,
        kind: 'topup',
        amount: dto.amount,
        method: dto.method,
        reference,
        proofKey: dto.proofKey,
      },
    });
    await this.tellAdmins(request);
    return this.presentRequest(request);
  }

  // Drivers take out what they have earned through the wallet. The amount is
  // held right away so it cannot be spent twice while the admin pays it out.
  async requestWithdrawal(userId: string, dto: WithdrawalRequestDto) {
    const settings = await this.settings();
    if (dto.amount < settings.minWithdrawal) {
      throw new BadRequestException(
        `The least you can withdraw is Rs ${settings.minWithdrawal}`,
      );
    }
    await this.assertFewPending(userId, 'withdrawal');
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.walletRequest.create({
        data: {
          userId,
          kind: 'withdrawal',
          amount: dto.amount,
          method: dto.method,
          accountTitle: dto.accountTitle.trim(),
          accountNumber: dto.accountNumber.trim(),
        },
      });
      await this.post(tx, {
        userId,
        type: 'withdrawal',
        amount: -dto.amount,
        key: `request:${created.id}:hold`,
        requestId: created.id,
      });
      return created;
    });
    this.notify(userId);
    await this.tellAdmins(request);
    return this.presentRequest(request);
  }

  async cancelRequest(userId: string, requestId: string) {
    const request = await this.prisma.walletRequest.findFirst({
      where: { id: requestId, userId },
    });
    if (!request) throw new NotFoundException('Request not found');
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.walletRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'cancelled' },
      });
      if (done.count === 0) {
        throw new ConflictException('This request is no longer pending');
      }
      if (request.kind === 'withdrawal') await this.release(tx, request);
    });
    if (request.kind === 'withdrawal') this.notify(userId);
    return this.presentRequest({ ...request, status: 'cancelled' });
  }

  // Gives back a withdrawal's held amount.
  async release(tx: Tx, request: WalletRequest, actorId?: string) {
    await this.post(tx, {
      userId: request.userId,
      type: 'withdrawal_reversal',
      amount: request.amount,
      key: `request:${request.id}:release`,
      requestId: request.id,
      actorId,
      allowNegative: true,
    });
  }

  // The admin panel's bell: a top-up to check or a withdrawal to pay out.
  private async tellAdmins(request: WalletRequest) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: request.userId },
        select: { name: true, phone: true },
      });
      const who = user?.name ?? user?.phone ?? 'Someone';
      await this.notifications.create({
        type: `wallet.${request.kind}`,
        title:
          request.kind === 'topup' ? 'Top-up to check' : 'Withdrawal to pay',
        body:
          request.kind === 'topup'
            ? `${who} sent Rs ${request.amount} by ${request.method} (${request.reference})`
            : `${who} asked for Rs ${request.amount} to ${request.method}`,
        targetType: 'wallet_request',
        targetId: request.id,
      });
    } catch (error) {
      this.logger.warn(`Could not notify admins: ${String(error)}`);
    }
  }

  private async assertFewPending(userId: string, kind: 'topup' | 'withdrawal') {
    const pending = await this.prisma.walletRequest.count({
      where: { userId, kind, status: 'pending' },
    });
    if (pending >= MAX_PENDING_REQUESTS) {
      throw new ConflictException(
        `You already have ${pending} ${kind === 'topup' ? 'top-ups' : 'withdrawals'} waiting. Please wait for them to be checked.`,
      );
    }
  }

  // ---- Shapes -------------------------------------------------------------

  presentTransaction(t: WalletTransaction) {
    return {
      id: t.id,
      type: t.type,
      label: TRANSACTION_LABELS[t.type],
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      rideId: t.rideId,
      requestId: t.requestId,
      note: t.note,
      createdAt: t.createdAt,
    };
  }

  presentRequest(r: WalletRequest) {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      amount: r.amount,
      method: r.method,
      reference: r.reference,
      accountTitle: r.accountTitle,
      accountNumber: r.accountNumber,
      rejectReason: r.rejectReason,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    };
  }

  async signed(key: string | null) {
    if (!key) return null;
    try {
      return await this.storage.createSignedUrl(key, 60 * 60);
    } catch (error) {
      this.logger.warn(`Could not sign ${key}: ${String(error)}`);
      return null;
    }
  }
}
