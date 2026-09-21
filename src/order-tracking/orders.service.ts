import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizePkPhone } from '../common/phone.js';
import { DomainEvents } from '../events/domain-events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoutingProvider } from '../routing/routing.provider.js';
import { OrderLocationDto, UpsertOrderDto } from './dto/order.dto.js';
import { OrderStatusService } from './order-status.service.js';
import { OrderWithStatus, presentOrder } from './order-view.js';
import { resolveStatusKey } from './status-resolver.js';
import { TrackingTokenService } from './tracking-token.service.js';

// One trail point is kept at most this often, for the admin's route view.
const TRAIL_MIN_GAP_MS = 30_000;
// The other system's own ETA is trusted only while its position is this fresh.
const ETA_FRESH_MS = 120_000;
// Times sent by the other system may be a little ahead of our clock, not a lot.
const MAX_FUTURE_MS = 5 * 60_000;
const DEFAULT_TOKEN_TTL_HOURS = 24;

// The plain columns a request can set (only what was sent is present).
interface OrderFields {
  customerRef?: string;
  customerPhone?: string | null;
  pickupLat?: number;
  pickupLng?: number;
  pickupAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryAddress?: string;
  deliveryPersonId?: string;
  deliveryPersonName?: string;
  deliveryPersonPhone?: string;
  deliveryPersonPhotoUrl?: string;
  deliveryPersonRating?: number;
  vehicleType?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehiclePlate?: string;
}

@Injectable()
export class OrdersService {
  private readonly lastTrailPoint = new Map<string, number>();
  private readonly tokenTtlHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly statuses: OrderStatusService,
    private readonly tokens: TrackingTokenService,
    private readonly routing: RoutingProvider,
    private readonly events: DomainEvents,
    config: ConfigService,
  ) {
    this.tokenTtlHours = Number(
      config.get('TRACKING_TOKEN_TTL_HOURS') ?? DEFAULT_TOKEN_TTL_HOURS,
    );
  }

  // Create the order, or update the one that already exists for this source and id.
  // The other system can call this as often as it likes with whatever changed.
  async upsert(externalId: string, dto: UpsertOrderDto) {
    const source = dto.source ?? 'fazl';
    const existing = await this.find(source, externalId);
    if (!existing) {
      try {
        return await this.createOrder(source, externalId, dto);
      } catch (error: any) {
        // Two calls for a brand new order at the same moment: the second one updates.
        if (error?.code !== 'P2002') throw error;
        const raced = await this.find(source, externalId);
        if (!raced) throw error;
        return this.updateOrder(raced, dto);
      }
    }
    return this.updateOrder(existing, dto);
  }

  private async createOrder(
    source: string,
    externalId: string,
    dto: UpsertOrderDto,
  ) {
    if (!dto.delivery) {
      throw new BadRequestException(
        'delivery (lat, lng) is required when an order is created',
      );
    }
    const statuses = await this.statuses.all();
    const key = dto.status
      ? this.resolveOrFail(dto.status, statuses)
      : (await this.statuses.firstActive()).key;
    const at = this.eventTime(dto.statusAt);
    const finishing = statuses.find((s) => s.key === key);

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trackedOrder.create({
        data: {
          source,
          externalId,
          statusKey: key,
          ...this.fieldsFrom(dto),
          deliveryLat: dto.delivery!.lat,
          deliveryLng: dto.delivery!.lng,
          deliveryAddress: dto.delivery!.address ?? '',
          deliveredAt: key === 'delivered' ? at : null,
        },
      });
      await tx.orderStatusEvent.create({
        data: { orderId: created.id, statusKey: key, at, note: dto.note },
      });
      return created;
    });
    this.events.emit('order.created', {
      orderId: order.id,
      status: key,
      finished: !!finishing?.terminal,
    });
    return this.viewById(order.id);
  }

  private async updateOrder(existing: OrderWithStatus, dto: UpsertOrderDto) {
    const statuses = await this.statuses.all();
    const newKey = dto.status
      ? this.resolveOrFail(dto.status, statuses)
      : existing.statusKey;
    const statusChanged = newKey !== existing.statusKey;
    const patch = this.fieldsFrom(dto);
    if (dto.delivery) {
      patch.deliveryLat = dto.delivery.lat;
      patch.deliveryLng = dto.delivery.lng;
      if (dto.delivery.address !== undefined)
        patch.deliveryAddress = dto.delivery.address;
    }
    const changes = statusChanged || Object.keys(patch).length > 0;

    // A delivered or cancelled order is closed: repeating what it already says is
    // harmless, changing it is not.
    if (existing.status.terminal && changes) {
      throw new ConflictException(
        `This order is already ${existing.status.label.toLowerCase()}`,
      );
    }
    if (!changes) return this.viewById(existing.id);

    const at = this.eventTime(dto.statusAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.trackedOrder.update({
        where: { id: existing.id },
        data: {
          ...patch,
          ...(statusChanged && {
            statusKey: newKey,
            deliveredAt: newKey === 'delivered' ? at : undefined,
          }),
        },
      });
      if (statusChanged) {
        await tx.orderStatusEvent.create({
          data: { orderId: existing.id, statusKey: newKey, at, note: dto.note },
        });
      }
    });
    this.events.emit('order.updated', {
      orderId: existing.id,
      statusChanged,
      status: newKey,
      finished: !!statuses.find((s) => s.key === newKey)?.terminal,
    });
    return this.viewById(existing.id);
  }

  // Frequent and light: called every few seconds by the other system while the
  // delivery person moves.
  async recordLocation(
    source: string,
    externalId: string,
    dto: OrderLocationDto,
  ) {
    const order = await this.find(source, externalId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status.terminal)
      return { accepted: false, reason: 'order_finished' };

    const at = this.eventTime(dto.at);
    await this.prisma.trackedOrder.update({
      where: { id: order.id },
      data: {
        lastLat: dto.lat,
        lastLng: dto.lng,
        lastHeading: dto.heading ?? null,
        lastLocationAt: at,
        etaSeconds: dto.etaSeconds ?? null,
      },
    });
    const lastKept = this.lastTrailPoint.get(order.id) ?? 0;
    if (at.getTime() - lastKept >= TRAIL_MIN_GAP_MS) {
      this.lastTrailPoint.set(order.id, at.getTime());
      await this.prisma.orderLocationPoint.create({
        data: {
          orderId: order.id,
          lat: dto.lat,
          lng: dto.lng,
          heading: dto.heading,
          at,
        },
      });
    }
    this.events.emit('order.location', {
      orderId: order.id,
      lat: dto.lat,
      lng: dto.lng,
      heading: dto.heading ?? null,
      etaSeconds: dto.etaSeconds ?? null,
      deliveryLat: order.deliveryLat,
      deliveryLng: order.deliveryLng,
      at,
    });
    return { accepted: true };
  }

  // The other system asks for a link/token so the customer can open this order.
  async createTrackingSession(
    source: string,
    externalId: string,
    ttlHours?: number,
  ) {
    const order = await this.find(source, externalId);
    if (!order) throw new NotFoundException('Order not found');
    const hours = ttlHours ?? this.tokenTtlHours;
    const { token, expiresAt } = await this.tokens.issue(
      order.id,
      hours * 3_600_000,
    );
    return { token, expiresAt, orderId: order.externalId };
  }

  async revokeTrackingSessions(source: string, externalId: string) {
    const order = await this.find(source, externalId);
    if (!order) throw new NotFoundException('Order not found');
    const revoked = await this.tokens.revokeAll(order.id);
    this.events.emit('order.tokens_revoked', { orderId: order.id });
    return { revoked };
  }

  async viewForToken(rawToken: string) {
    const found = await this.tokens.resolve(rawToken);
    if (!found)
      throw new UnauthorizedException(
        'This tracking link is invalid or has expired',
      );
    return this.viewById(found.orderId);
  }

  async viewBySource(source: string, externalId: string) {
    const order = await this.find(source, externalId);
    if (!order) throw new NotFoundException('Order not found');
    return this.viewById(order.id);
  }

  async viewById(orderId: string) {
    const order = await this.prisma.trackedOrder.findUnique({
      where: { id: orderId },
      include: { status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const [steps, events] = await Promise.all([
      this.statuses.all(),
      this.prisma.orderStatusEvent.findMany({
        where: { orderId },
        select: { statusKey: true, at: true },
        orderBy: { at: 'asc' },
      }),
    ]);
    const { distanceRemainingMeters, etaSeconds } = await this.progress(order);
    return presentOrder(order, {
      steps,
      events,
      distanceRemainingMeters,
      etaSeconds,
    });
  }

  // How far and how long is left: our own estimate from the last position, using
  // the other system's ETA instead while its position is fresh.
  private async progress(order: OrderWithStatus) {
    if (
      order.status.terminal ||
      order.lastLat == null ||
      order.lastLng == null
    ) {
      return { distanceRemainingMeters: null, etaSeconds: null };
    }
    const route = await this.routing.route(
      { lat: order.lastLat, lng: order.lastLng },
      { lat: order.deliveryLat, lng: order.deliveryLng },
    );
    const fresh =
      order.lastLocationAt &&
      Date.now() - order.lastLocationAt.getTime() < ETA_FRESH_MS;
    return {
      distanceRemainingMeters: route.distanceMeters,
      etaSeconds:
        fresh && order.etaSeconds != null
          ? order.etaSeconds
          : route.durationSeconds,
    };
  }

  private find(
    source: string,
    externalId: string,
  ): Promise<OrderWithStatus | null> {
    return this.prisma.trackedOrder.findUnique({
      where: { source_externalId: { source, externalId } },
      include: { status: true },
    });
  }

  private resolveOrFail(
    input: string,
    statuses: Awaited<ReturnType<OrderStatusService['all']>>,
  ) {
    const key = resolveStatusKey(input, statuses);
    if (key) return key;
    throw new BadRequestException({
      message: `Unknown status "${input}"`,
      validStatuses: statuses
        .filter((s) => s.active)
        .map((s) => ({ key: s.key, aliases: s.aliases })),
    });
  }

  private eventTime(iso?: string) {
    if (!iso) return new Date();
    const at = new Date(iso);
    if (at.getTime() > Date.now() + MAX_FUTURE_MS) {
      throw new BadRequestException('The time is in the future');
    }
    return at;
  }

  // The plain columns a request can set. Only what was sent is included, so an
  // update never wipes a field it did not mention.
  private fieldsFrom(dto: UpsertOrderDto) {
    const f: OrderFields = {};
    if (dto.customerRef !== undefined) f.customerRef = dto.customerRef;
    if (dto.customerPhone !== undefined)
      f.customerPhone = normalizePkPhone(dto.customerPhone);
    if (dto.pickup) {
      f.pickupLat = dto.pickup.lat;
      f.pickupLng = dto.pickup.lng;
      if (dto.pickup.address !== undefined)
        f.pickupAddress = dto.pickup.address;
    }
    if (dto.delivery) {
      f.deliveryLat = dto.delivery.lat;
      f.deliveryLng = dto.delivery.lng;
      if (dto.delivery.address !== undefined)
        f.deliveryAddress = dto.delivery.address;
    }
    const p = dto.deliveryPerson;
    if (p) {
      if (p.id !== undefined) f.deliveryPersonId = p.id;
      if (p.name !== undefined) f.deliveryPersonName = p.name;
      if (p.phone !== undefined) f.deliveryPersonPhone = p.phone;
      if (p.photoUrl !== undefined) f.deliveryPersonPhotoUrl = p.photoUrl;
      if (p.rating !== undefined) f.deliveryPersonRating = p.rating;
    }
    const v = dto.vehicle;
    if (v) {
      if (v.type !== undefined) f.vehicleType = v.type;
      if (v.make !== undefined) f.vehicleMake = v.make;
      if (v.model !== undefined) f.vehicleModel = v.model;
      if (v.color !== undefined) f.vehicleColor = v.color;
      if (v.plate !== undefined) f.vehiclePlate = v.plate;
    }
    return f;
  }
}
