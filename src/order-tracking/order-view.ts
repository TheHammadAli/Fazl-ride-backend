import type { OrderStatus, TrackedOrder } from '../generated/prisma/client.js';
import { buildTimeline, StatusEventRef, StatusStep } from './timeline.js';

export type OrderWithStatus = TrackedOrder & { status: OrderStatus };

export interface OrderViewContext {
  steps: StatusStep[];
  events: StatusEventRef[];
  distanceRemainingMeters: number | null;
  etaSeconds: number | null;
}

// What the customer's app gets. Deliberately small: no customer contact details,
// and while the order is finished there is no live location and no phone number.
export function presentOrder(order: OrderWithStatus, ctx: OrderViewContext) {
  const finished = order.status.terminal;
  const hasPerson = [
    order.deliveryPersonName,
    order.deliveryPersonId,
    order.deliveryPersonPhotoUrl,
  ].some(Boolean);
  const hasVehicle = [
    order.vehicleType,
    order.vehicleMake,
    order.vehicleModel,
    order.vehiclePlate,
  ].some(Boolean);
  const hasLocation = order.lastLat != null && order.lastLng != null;

  return {
    orderId: order.externalId,
    source: order.source,
    status: { key: order.status.key, label: order.status.label, finished },
    timeline: buildTimeline(ctx.steps, ctx.events, order.status.key),
    pickup:
      order.pickupLat != null && order.pickupLng != null
        ? {
            lat: order.pickupLat,
            lng: order.pickupLng,
            address: order.pickupAddress,
          }
        : null,
    delivery: {
      lat: order.deliveryLat,
      lng: order.deliveryLng,
      address: order.deliveryAddress,
    },
    deliveryPerson: hasPerson
      ? {
          name: order.deliveryPersonName,
          photoUrl: order.deliveryPersonPhotoUrl,
          rating: order.deliveryPersonRating,
          phone: finished ? null : order.deliveryPersonPhone,
          vehicle: hasVehicle
            ? {
                type: order.vehicleType,
                make: order.vehicleMake,
                model: order.vehicleModel,
                color: order.vehicleColor,
                plate: order.vehiclePlate,
              }
            : null,
        }
      : null,
    location:
      hasLocation && !finished
        ? {
            lat: order.lastLat as number,
            lng: order.lastLng as number,
            heading: order.lastHeading,
            updatedAt: order.lastLocationAt,
          }
        : null,
    etaSeconds: finished ? null : ctx.etaSeconds,
    distanceRemainingMeters: finished ? null : ctx.distanceRemainingMeters,
    deliveredAt: order.deliveredAt,
    updatedAt: order.updatedAt,
  };
}
