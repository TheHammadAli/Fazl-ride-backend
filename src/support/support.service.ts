import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DomainEvents } from '../events/domain-events.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { SupportTicketStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type {
  CreateTicketDto,
  ListTicketsDto,
  UpdateTicketDto,
} from './dto/support.dto.js';
import {
  categoryByKey,
  SUPPORT_CATEGORIES,
  ticketCode,
} from './support-categories.js';

const OPEN: SupportTicketStatus[] = ['open', 'in_progress'];
const person = { select: { id: true, name: true, phone: true } } as const;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: AdminNotificationsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly wallet: WalletService,
  ) {}

  categories(role?: 'passenger' | 'driver') {
    return {
      items: SUPPORT_CATEGORIES.filter(
        (c) => !role || c.for.includes(role),
      ).map((c) => ({
        key: c.key,
        label: c.label,
        needsRide: c.needsRide,
        for: c.for,
      })),
    };
  }

  // ------------------------------------------------------------------ user

  async create(userId: string, dto: CreateTicketDto) {
    const category = categoryByKey(dto.category);
    if (!category) throw new BadRequestException('Unknown category');

    let role: 'passenger' | 'driver' = dto.as ?? 'passenger';
    let againstUserId: string | null = null;
    if (dto.rideId) {
      const ride = await this.prisma.ride.findFirst({
        where: {
          id: dto.rideId,
          OR: [{ passengerId: userId }, { driverId: userId }],
        },
        select: { passengerId: true, driverId: true },
      });
      if (!ride) throw new ForbiddenException('Not your ride');
      role = ride.driverId === userId ? 'driver' : 'passenger';
      if (category.aboutOther) {
        againstUserId = role === 'driver' ? ride.passengerId : ride.driverId;
      }
    } else if (category.needsRide) {
      throw new BadRequestException('Choose the ride this is about');
    }
    if (!category.for.includes(role)) {
      throw new BadRequestException(`"${category.label}" is not for a ${role}`);
    }

    // The same problem twice on one ride: back to the ticket already open.
    if (dto.rideId) {
      const same = await this.prisma.supportTicket.findFirst({
        where: {
          userId,
          rideId: dto.rideId,
          category: category.key,
          status: { in: OPEN },
        },
        select: { id: true, number: true },
      });
      if (same) {
        throw new ConflictException({
          message: `You already reported this. See ticket #${ticketCode(same.number)}.`,
          code: 'TICKET_EXISTS',
          ticketId: same.id,
        });
      }
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        role,
        rideId: dto.rideId,
        againstUserId,
        category: category.key,
        priority: category.priority,
        description: dto.description.trim(),
      },
    });
    const code = ticketCode(ticket.number);
    await this.notifications.create({
      type: 'support_ticket',
      title: `${ticket.priority === 'urgent' ? 'URGENT ' : ''}New complaint #${code}: ${category.label}`,
      body: dto.description.trim().slice(0, 140),
      targetType: 'support_ticket',
      targetId: ticket.id,
    });
    await this.audit.log(
      userId,
      'support.create',
      'support_ticket',
      ticket.id,
      {
        category: category.key,
      },
    );
    return this.mine(userId, ticket.id);
  }

  async listMine(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { lastActivityAt: 'desc' },
      take: 50,
      include: { ride: { select: this.rideBrief } },
    });
    return { items: tickets.map((t) => this.userView(t)) };
  }

  async mine(userId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId },
      include: {
        ride: { select: this.rideBrief },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return {
      ...this.userView(ticket),
      messages: ticket.messages.map((m) => ({
        id: m.id,
        fromSupport: m.fromSupport,
        body: m.body,
        createdAt: m.createdAt,
      })),
    };
  }

  async reply(userId: string, id: string, body: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id, userId },
      select: { id: true, number: true, status: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'resolved') {
      throw new ConflictException(
        'This ticket is closed. Open a new one if you still need help.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: id,
          authorId: userId,
          fromSupport: false,
          body: body.trim(),
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: { lastActivityAt: new Date() },
      }),
    ]);
    await this.notifications.create({
      type: 'support_reply',
      title: `New reply on #${ticketCode(ticket.number)}`,
      body: body.trim().slice(0, 140),
      targetType: 'support_ticket',
      targetId: id,
    });
    return this.mine(userId, id);
  }

  // ----------------------------------------------------------------- admin

  async list(q: ListTicketsDto) {
    const search = q.search?.trim();
    const number = search?.replace(/^#?(fz-?)?/i, '');
    const where: Prisma.SupportTicketWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.priority && { priority: q.priority }),
      ...(q.category && { category: q.category }),
      ...(search && {
        OR: [
          ...(number && /^\d+$/.test(number)
            ? [{ number: Number(number) }]
            : []),
          { description: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { phone: { contains: search } } },
          { against: { name: { contains: search, mode: 'insensitive' } } },
          { against: { phone: { contains: search } } },
        ],
      }),
    };
    const [items, total, byStatus, urgentOpen] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        // Unhandled first, then the most urgent, then the latest activity.
        orderBy: [
          { status: 'asc' },
          { priority: 'desc' },
          { lastActivityAt: 'desc' },
        ],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          user: person,
          against: person,
          ride: { select: this.rideBrief },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: true }),
      this.prisma.supportTicket.count({
        where: { status: { in: OPEN }, priority: 'urgent' },
      }),
    ]);
    return {
      items: items.map((t) => ({
        ...this.adminBrief(t),
        messages: t._count.messages,
      })),
      total,
      page: q.page,
      limit: q.limit,
      counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      urgentOpen,
    };
  }

  async get(id: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: person,
        against: person,
        ride: {
          select: {
            ...this.rideBrief,
            status: true,
            category: true,
            fare: true,
            estimatedFare: true,
            offeredFare: true,
            paymentMethod: true,
            completedAt: true,
            passenger: person,
            driver: person,
            vehicle: {
              select: {
                make: true,
                model: true,
                color: true,
                plateNumber: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { name: true, email: true } } },
        },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found');
    // How often these people come up, to spot a pattern.
    const [byUser, againstOther] = await Promise.all([
      this.prisma.supportTicket.count({ where: { userId: t.userId } }),
      t.againstUserId
        ? this.prisma.supportTicket.count({
            where: { againstUserId: t.againstUserId },
          })
        : Promise.resolve(0),
    ]);
    return {
      ...this.adminBrief(t),
      ride: t.ride,
      resolution: t.resolution,
      refundAmount: t.refundAmount,
      resolvedAt: t.resolvedAt,
      firstReplyAt: t.firstReplyAt,
      history: { ticketsByUser: byUser, complaintsAgainst: againstOther },
      messages: t.messages.map((m) => ({
        id: m.id,
        fromSupport: m.fromSupport,
        body: m.body,
        createdAt: m.createdAt,
        author: m.fromSupport
          ? (m.author.name ?? m.author.email ?? 'Support')
          : null,
      })),
    };
  }

  async adminReply(adminId: string, id: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { userId: true, number: true, status: true, firstReplyAt: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'resolved') {
      throw new ConflictException('This ticket is resolved');
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: {
          ticketId: id,
          authorId: adminId,
          fromSupport: true,
          body: body.trim(),
        },
      }),
      this.prisma.supportTicket.update({
        where: { id },
        data: {
          status: 'in_progress',
          lastActivityAt: now,
          firstReplyAt: ticket.firstReplyAt ?? now,
          assignedToId: adminId,
        },
      }),
    ]);
    await this.audit.log(adminId, 'support.reply', 'support_ticket', id);
    this.events.emit('support.reply', {
      ticketId: id,
      userId: ticket.userId,
      code: ticketCode(ticket.number),
    });
    return this.get(id);
  }

  async update(adminId: string, id: string, dto: UpdateTicketDto) {
    const { count } = await this.prisma.supportTicket.updateMany({
      where: { id, status: { in: OPEN } },
      data: { priority: dto.priority, status: dto.status },
    });
    if (!count) {
      const exists = await this.prisma.supportTicket.count({ where: { id } });
      if (!exists) throw new NotFoundException('Ticket not found');
      throw new ConflictException('This ticket is resolved');
    }
    await this.audit.log(adminId, 'support.update', 'support_ticket', id, {
      ...(dto.priority && { priority: dto.priority }),
      ...(dto.status && { status: dto.status }),
    });
    return this.get(id);
  }

  // Closes it with what was done; a refund goes into the person's wallet in
  // the same transaction (once, whatever happens).
  async resolve(
    adminId: string,
    id: string,
    resolution: string,
    refundAmount?: number,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { userId: true, number: true, status: true, rideId: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'resolved') {
      throw new ConflictException('This ticket is already resolved');
    }
    const code = ticketCode(ticket.number);
    const text = resolution.trim();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.supportTicket.updateMany({
        where: { id, status: { in: OPEN } },
        data: {
          status: 'resolved',
          resolution: text,
          refundAmount: refundAmount ?? null,
          resolvedAt: now,
          resolvedById: adminId,
          lastActivityAt: now,
        },
      });
      if (!count)
        throw new ConflictException('This ticket is already resolved');
      await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorId: adminId,
          fromSupport: true,
          body: refundAmount
            ? `${text}\n\nRs ${refundAmount} has been added to your FAZL wallet.`
            : text,
        },
      });
      if (refundAmount) {
        await this.wallet.post(tx, {
          userId: ticket.userId,
          type: 'refund',
          amount: refundAmount,
          key: `ticket:${id}:refund`,
          rideId: ticket.rideId ?? undefined,
          note: `Support ticket #${code}`,
          actorId: adminId,
        });
      }
    });
    if (refundAmount) this.wallet.notify(ticket.userId);
    await this.audit.log(adminId, 'support.resolve', 'support_ticket', id, {
      refundAmount: refundAmount ?? null,
    });
    this.events.emit('support.resolved', {
      ticketId: id,
      userId: ticket.userId,
      code,
      refundAmount: refundAmount ?? null,
    });
    return this.get(id);
  }

  // --------------------------------------------------------------- helpers

  private readonly rideBrief = {
    id: true,
    pickupAddress: true,
    dropoffAddress: true,
    requestedAt: true,
  } satisfies Prisma.RideSelect;

  private userView(t: {
    id: string;
    number: number;
    category: string;
    status: SupportTicketStatus;
    rideId: string | null;
    description: string;
    resolution: string | null;
    refundAmount: number | null;
    createdAt: Date;
    lastActivityAt: Date;
    ride: {
      id: string;
      pickupAddress: string;
      dropoffAddress: string;
      requestedAt: Date;
    } | null;
  }) {
    return {
      id: t.id,
      code: ticketCode(t.number),
      category: {
        key: t.category,
        label: categoryByKey(t.category)?.label ?? t.category,
      },
      status: t.status,
      rideId: t.rideId,
      ride: t.ride,
      description: t.description,
      resolution: t.resolution,
      refundAmount: t.refundAmount,
      createdAt: t.createdAt,
      lastActivityAt: t.lastActivityAt,
    };
  }

  private adminBrief(t: {
    id: string;
    number: number;
    role: string;
    category: string;
    priority: string;
    status: SupportTicketStatus;
    description: string;
    createdAt: Date;
    lastActivityAt: Date;
    user: { id: string; name: string | null; phone: string };
    against: { id: string; name: string | null; phone: string } | null;
    ride: {
      id: string;
      pickupAddress: string;
      dropoffAddress: string;
      requestedAt: Date;
    } | null;
  }) {
    return {
      id: t.id,
      code: ticketCode(t.number),
      role: t.role,
      category: {
        key: t.category,
        label: categoryByKey(t.category)?.label ?? t.category,
      },
      priority: t.priority,
      status: t.status,
      description: t.description,
      createdAt: t.createdAt,
      lastActivityAt: t.lastActivityAt,
      user: t.user,
      against: t.against,
      rideId: t.ride?.id ?? null,
      rideBrief: t.ride,
    };
  }
}
