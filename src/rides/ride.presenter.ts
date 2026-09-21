import type { Prisma } from '../generated/prisma/client.js';
import type { DriverPosition } from '../presence/driver-location.store.js';

export const rideInclude = {
  passenger: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true } },
  vehicle: {
    select: {
      make: true,
      model: true,
      color: true,
      plateNumber: true,
      category: true,
    },
  },
} satisfies Prisma.RideInclude;

export type RideWithRelations = Prisma.RideGetPayload<{
  include: typeof rideInclude;
}>;

export interface RideViewExtras {
  driverLocation?: DriverPosition | null;
  driverEtaSeconds?: number | null;
}

// The shape both apps get for a ride. Ratings are added once B5 lands.
export function presentRide(
  ride: RideWithRelations,
  extras: RideViewExtras = {},
) {
  return {
    id: ride.id,
    status: ride.status,
    category: ride.category,
    currency: 'PKR',
    paymentMethod: ride.paymentMethod,
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
    fare: ride.fare,
    cancellationFee: ride.cancellationFee,
    cancelledBy: ride.cancelledBy,
    cancelReason: ride.cancelReason,
    passenger: { id: ride.passenger.id, name: ride.passenger.name },
    driver: ride.driver
      ? {
          id: ride.driver.id,
          name: ride.driver.name,
          vehicle: ride.vehicle,
          location: extras.driverLocation
            ? {
                lat: extras.driverLocation.lat,
                lng: extras.driverLocation.lng,
                heading: extras.driverLocation.heading,
              }
            : null,
          etaSeconds: extras.driverEtaSeconds ?? null,
        }
      : null,
    requestedAt: ride.requestedAt,
    expiresAt: ride.status === 'requested' ? ride.expiresAt : null,
    acceptedAt: ride.acceptedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
  };
}
