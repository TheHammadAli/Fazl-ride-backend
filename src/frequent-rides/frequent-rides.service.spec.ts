import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { describe, expect, it, vi } from 'vitest';
import { FrequentRidesService } from './frequent-rides.service.js';

const routeId = '7b3b823a-a7e8-49a8-b120-7e3e2f9e8400';
const passengerId = '7419ac0d-09b7-46c0-9e3e-cc1a01fabc21';
const date = '2027-01-05'; // Tuesday

const stops = [
  { id: 'a', position: 0, title: 'A', lat: 31.5, lng: 74.3 },
  { id: 'b', position: 1, title: 'B', lat: 31.51, lng: 74.3 },
  { id: 'c', position: 2, title: 'C', lat: 31.52, lng: 74.3 },
];

function makeService(options?: {
  bookings?: Array<{
    fromPosition: number;
    toPosition: number;
    seats: number;
    passengerId: string;
  }>;
}) {
  const route = {
    id: routeId,
    driverId: 'driver-id',
    vehicleId: 'vehicle-id',
    title: 'A to C',
    departureTime: '09:00',
    days: [2],
    seats: 3,
    fare: 1000,
    active: true,
    stops,
    bookings: options?.bookings ?? [],
    driver: { id: 'driver-id', name: 'Driver', ratingSum: 10, ratingCount: 2 },
    vehicle: {
      id: 'vehicle-id',
      make: 'Car',
      model: 'Model',
      color: 'Blue',
      category: 'car',
    },
  };
  const createBooking = vi
    .fn()
    .mockResolvedValue({ id: 'booking-id', fare: 500 });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    frequentRideRoute: { findFirst: vi.fn().mockResolvedValue(route) },
    frequentRideBooking: { create: createBooking },
  } as unknown as Prisma.TransactionClient;
  const prisma = {
    frequentRideRoute: { findMany: vi.fn().mockResolvedValue([route]) },
    $transaction: vi.fn(
      async (callback: (client: Prisma.TransactionClient) => unknown) =>
        callback(tx),
    ),
  } as unknown as PrismaService;
  const config = {
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  return {
    service: new FrequentRidesService(prisma, config),
    prisma,
    tx,
    createBooking,
    route,
  };
}

describe('FrequentRidesService', () => {
  it('matches ordered nearby stops and calculates remaining seats and segment fare', async () => {
    const { service } = makeService({
      bookings: [
        { fromPosition: 0, toPosition: 1, seats: 2, passengerId: 'other' },
      ],
    });

    const result = await service.search({
      date,
      pickupLat: stops[0].lat,
      pickupLng: stops[0].lng,
      dropoffLat: stops[2].lat,
      dropoffLng: stops[2].lng,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      fromPosition: 0,
      toPosition: 2,
      availableSeats: 1,
      fare: 1000,
    });
  });

  it('books the requested segment with a server-calculated fare and route-date lock', async () => {
    const { service, tx, createBooking } = makeService();

    await service.book(passengerId, routeId, {
      date,
      fromPosition: 0,
      toPosition: 1,
      seats: 1,
    });

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passengerId,
          routeId,
          fromPosition: 0,
          toPosition: 1,
          seats: 1,
          fare: 500,
        }),
      }),
    );
  });

  it('rejects a segment booking when overlapping reservations use all seats', async () => {
    const { service, createBooking } = makeService({
      bookings: [
        { fromPosition: 0, toPosition: 2, seats: 3, passengerId: 'other' },
      ],
    });

    await expect(
      service.book(passengerId, routeId, {
        date,
        fromPosition: 0,
        toPosition: 1,
        seats: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createBooking).not.toHaveBeenCalled();
  });
});
