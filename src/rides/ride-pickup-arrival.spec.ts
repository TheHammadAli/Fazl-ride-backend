import { ConflictException } from '@nestjs/common';
import { RidesService } from './rides.service.js';

const NOW = new Date('2026-11-12T09:00:00Z');
const RIDE = '11111111-1111-1111-1111-111111111111';
const DRIVER = '22222222-2222-2222-2222-222222222222';
// The pickup, and points north of it: 0.001° of latitude is about 111 m.
const PICKUP = { lat: 33.7, lng: 73.05 };
const north = (meters: number) => ({
  lat: PICKUP.lat + meters / 111_195,
  lng: PICKUP.lng,
});

function make(driverAt: { lat: number; lng: number } | null) {
  const ride = {
    id: RIDE,
    driverId: DRIVER,
    passengerId: 'p',
    status: 'accepted',
    pickupLat: PICKUP.lat,
    pickupLng: PICKUP.lng,
  };
  const prisma = {
    ride: {
      findFirst: vi.fn(async () => ride),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const locations = { getLocation: vi.fn(async () => driverAt) };
  // A stop's radius stays tighter: only the pickup's is widened.
  const settings = { arrivalRadiusMeters: 300, pickupRadiusMeters: 1000 };
  const events = { emit: vi.fn() };
  const none = {} as never;
  const service = new RidesService(
    prisma as never,
    none, // fares
    none, // matching
    locations as never,
    none, // routing
    settings as never,
    events as never,
    none, // cancellations
    none, // ratings
    none, // earnings
    none, // vehicleCategories
    none, // storage
    none, // wallet
    none, // reservations
    none, // bookingSettings
    none, // tiers
    none, // serviceAreas
    none, // promos
  );
  vi.spyOn(service, 'get').mockResolvedValue({} as never);
  return { service, prisma, events };
}

describe('arriving at the pickup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('lets the driver press Arrived from up to 1 km away', async () => {
    const { service, prisma, events } = make(north(950));
    await service.arrived(DRIVER, RIDE);
    expect(prisma.ride.updateMany).toHaveBeenCalledWith({
      where: { id: RIDE, driverId: DRIVER, status: 'accepted' },
      data: { status: 'arrived', arrivedAt: NOW },
    });
    expect(events.emit).toHaveBeenCalledWith('ride.arrived', {
      rideId: RIDE,
      driverId: DRIVER,
    });
  });

  it('lets the driver who is 443 m away arrive (refused at 300 m before)', async () => {
    const { service, prisma } = make(north(443));
    await service.arrived(DRIVER, RIDE);
    expect(prisma.ride.updateMany).toHaveBeenCalled();
  });

  it('refuses from more than 1 km away, saying how far', async () => {
    const { service, prisma } = make(north(1200));
    await expect(service.arrived(DRIVER, RIDE)).rejects.toThrow(
      /You are 1200 m from the pickup; get within 1000 m first/,
    );
    expect(prisma.ride.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the driver’s position is unknown', async () => {
    const { service } = make(null);
    await expect(service.arrived(DRIVER, RIDE)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
