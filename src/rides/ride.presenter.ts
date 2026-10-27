import type { Prisma } from '../generated/prisma/client.js';
import { ratingView } from './rating.js';
import type { DriverPosition } from '../presence/driver-location.store.js';

export const rideInclude = {
  passenger: {
    select: {
      id: true,
      name: true,
      phone: true,
      ratingSum: true,
      ratingCount: true,
    },
  },
  driver: {
    select: {
      id: true,
      name: true,
      phone: true,
      avatarKey: true,
      ratingSum: true,
      ratingCount: true,
    },
  },
  vehicle: {
    select: {
      make: true,
      model: true,
      color: true,
      plateNumber: true,
      category: true,
    },
  },
  promoRedemption: {
    select: { status: true, discount: true, promo: { select: { code: true } } },
  },
} satisfies Prisma.RideInclude;

export type RideWithRelations = Prisma.RideGetPayload<{
  include: typeof rideInclude;
}>;

export interface RideViewExtras {
  driverLocation?: DriverPosition | null;
  driverEtaSeconds?: number | null;
  driverDistanceToPickupMeters?: number | null;
  // What the person looking at the ride gave the other party, if anything yet.
  myRating?: { stars: number; comment: string | null } | null;
  // A short-lived signed URL, resolved by the caller (RidesService has the
  // StorageService this presenter does not) - null while none is set.
  driverAvatarUrl?: string | null;
  // Freight: signed URL of the photo of the goods.
  loadPhotoUrl?: string | null;
  // A booking for later: when its confirmed driver may press Start.
  booking?: { kind: string; startFrom: Date; startUntil: Date } | null;
}

// Phone numbers are shared only while a ride is on, and only with the two people on it
// (the ride can only be read by them), so the Call button in both apps works.
const PHONE_VISIBLE = ['accepted', 'arrived', 'started'];

// The shape both apps get for a ride. Ratings are added once B5 lands.
export function presentRide(
  ride: RideWithRelations,
  extras: RideViewExtras = {},
) {
  // Phones are shared while the ride is on, and for a booking for later
  // once its driver is confirmed, so the two can agree the pickup.
  const contactOpen =
    PHONE_VISIBLE.includes(ride.status) ||
    (ride.status === 'scheduled' && ride.driverId != null);
  return {
    id: ride.id,
    status: ride.status,
    category: ride.category,
    tripType: ride.tripType,
    service: ride.service,
    // Freight: what is being moved, and what it takes at each end.
    freight:
      ride.service === 'freight'
        ? {
            loadDescription: ride.loadDescription,
            loadWeightKg: ride.loadWeightKg,
            helpersNeeded: ride.helpersNeeded,
            loadPhotoUrl: extras.loadPhotoUrl ?? null,
            pickupFloor: ride.pickupFloor,
            pickupHasLift: ride.pickupHasLift,
            dropoffFloor: ride.dropoffFloor,
            dropoffHasLift: ride.dropoffHasLift,
            needsLoading: ride.needsLoading,
            needsUnloading: ride.needsUnloading,
          }
        : null,
    currency: 'PKR',
    paymentMethod: ride.paymentMethod,
    // Once completed: how the fare was paid. The driver collects `cash`.
    payment:
      ride.status === 'completed' && ride.fare != null
        ? {
            walletPaid: ride.walletPaid ?? 0,
            promo: ride.promoDiscount ?? 0,
            cash:
              ride.fare - (ride.walletPaid ?? 0) - (ride.promoDiscount ?? 0),
          }
        : null,
    // A promo code on the ride; its discount is known once completed.
    promo: ride.promoRedemption
      ? { code: ride.promoRedemption.promo.code }
      : null,
    pickup: {
      lat: ride.pickupLat,
      lng: ride.pickupLng,
      address: ride.pickupAddress,
    },
    dropoff: {
      lat: ride.dropoffLat,
      lng: ride.dropoffLng,
      address: ride.dropoffAddress,
    },
    estimate: {
      fare: ride.estimatedFare,
      distanceMeters: ride.estimatedDistanceMeters,
      durationSeconds: ride.estimatedDurationSeconds,
    },
    // Bidding (InDrive-style): true while this ride is being matched by offers
    // and a chosen price rather than the fixed quote above. offeredFare is
    // what the passenger put forward; fare is the agreed price once someone
    // is chosen (set at that point, not only at completion).
    negotiable: ride.negotiable,
    offeredFare: ride.offeredFare,
    autoAccept: ride.autoAccept,
    fare: ride.fare,
    myRating: extras.myRating ?? null,
    cancelledBy: ride.cancelledBy,
    cancelReason: ride.cancelReason,
    cancelledFromStatus: ride.cancelledFromStatus,
    passenger: {
      id: ride.passenger.id,
      name: ride.passenger.name,
      phone: contactOpen ? ride.passenger.phone : null,
      rating: ratingView(ride.passenger.ratingSum, ride.passenger.ratingCount),
    },
    driver: ride.driver
      ? {
          id: ride.driver.id,
          name: ride.driver.name,
          phone: contactOpen ? ride.driver.phone : null,
          avatarUrl: extras.driverAvatarUrl ?? null,
          rating: ratingView(ride.driver.ratingSum, ride.driver.ratingCount),
          vehicle: ride.vehicle,
          location: extras.driverLocation
            ? {
                lat: extras.driverLocation.lat,
                lng: extras.driverLocation.lng,
                heading: extras.driverLocation.heading,
              }
            : null,
          // While the driver is on the way: how far and how long until pickup.
          etaSeconds: extras.driverEtaSeconds ?? null,
          distanceToPickupMeters: extras.driverDistanceToPickupMeters ?? null,
        }
      : null,
    requestedAt: ride.requestedAt,
    scheduledAt: ride.scheduledAt,
    booking: extras.booking ?? null,
    noShow: ride.noShow,
    expiresAt: ride.status === 'requested' ? ride.expiresAt : null,
    acceptedAt: ride.acceptedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
  };
}
