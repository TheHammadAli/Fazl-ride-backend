import { ConflictException, NotFoundException } from '@nestjs/common';
import { RidesService } from './rides.service.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const RIDE = '11111111-1111-1111-1111-111111111111';
const DRIVER = '22222222-2222-2222-2222-222222222222';
const RATES = {
  baseFare: 100,
  perKm: 0,
  perMinute: 10,
  minimumFare: 0,
  freeWaitingMinutes: 3,
  waitingPerMinute: 10,
};

type Stop = {
  id: string;
  position: number;
  lat: number;
  lng: number;
  arrivedAt: Date | null;
  departedAt: Date | null;
  waitedSeconds: number | null;
  waitingCharge: number | null;
};
const stop = (position: number, extra: Partial<Stop> = {}): Stop => ({
  id: `s${position}`,
  position,
  lat: 31.5 + position / 100,
  lng: 74.3,
  arrivedAt: null,
  departedAt: null,
  waitedSeconds: null,
  waitingCharge: null,
  ...extra,
});

function make(opts: { stops: Stop[]; ride?: Record<string, unknown> }) {
  const ride = {
    id: RIDE,
    driverId: DRIVER,
    passengerId: 'p',
    status: 'started',
    rates: RATES,
    negotiable: false,
    scheduledAt: null,
    fare: null,
    estimatedFare: 1000,
    estimatedDistanceMeters: 5000,
    trackedMeters: 0,
    pickupLat: 31.5,
    pickupLng: 74.3,
    startedAt: minutesAgo(20),
    paymentMethod: 'cash',
    category: 'car',
    tripType: 'within_city',
    ...opts.ride,
  };
  const prisma = {
    ride: {
      findFirst: vi.fn(async () => ride),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    rideStop: {
      findMany: vi.fn(async () => opts.stops),
      findUnique: vi.fn(
        async ({ where }: any) =>
          opts.stops.find(
            (s) => s.position === where.rideId_position.position,
          ) ?? null,
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const locations = {
    getLocation: vi.fn(async () => ({ lat: 31.51, lng: 74.3 })),
  };
  const settings = {
    arrivalRadiusMeters: 300,
    maxStopWaitMinutes: 60,
    maxFareFactor: 3,
  };
  const events = { emit: vi.fn() };
  const earnings = { recordRideFare: vi.fn(), recordCommission: vi.fn() };
  const promos = { redeem: vi.fn(async () => 0) };
  const wallet = {
    settleRide: vi.fn(async () => ({ walletPaid: 0, commission: 0 })),
    notify: vi.fn(),
  };
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
    earnings as never,
    none, // vehicleCategories
    none, // storage
    wallet as never,
    none, // reservations
    none, // bookingSettings
    none, // tiers
    none, // serviceAreas
    promos as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({} as never);
  return { service, prisma, locations, events, earnings };
}

describe('stops on the way', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  describe('arriving at a stop', () => {
    it('marks the driver there when they are close enough', async () => {
      const { service, prisma, events } = make({ stops: [stop(1), stop(2)] });
      await service.arriveAtStop(DRIVER, RIDE, 1);
      expect(prisma.rideStop.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', arrivedAt: null },
        data: { arrivedAt: NOW },
      });
      expect(events.emit).toHaveBeenCalledWith('ride.stop_arrived', {
        rideId: RIDE,
        driverId: DRIVER,
        position: 1,
      });
    });

    it('refuses from too far away', async () => {
      const { service, locations, prisma } = make({ stops: [stop(1)] });
      locations.getLocation.mockResolvedValue({ lat: 31.6, lng: 74.3 });
      await expect(service.arriveAtStop(DRIVER, RIDE, 1)).rejects.toThrow(
        /from stop 1; get within 300 m/,
      );
      expect(prisma.rideStop.updateMany).not.toHaveBeenCalled();
    });

    it('refuses while still at another stop, at an earlier stop once past it, and twice', async () => {
      const waiting = make({
        stops: [stop(1, { arrivedAt: minutesAgo(2) }), stop(2)],
      });
      await expect(
        waiting.service.arriveAtStop(DRIVER, RIDE, 2),
      ).rejects.toThrow('Press Continue at stop 1 first');

      const past = make({
        stops: [
          stop(1),
          stop(2, { arrivedAt: minutesAgo(9), departedAt: minutesAgo(5) }),
        ],
      });
      await expect(past.service.arriveAtStop(DRIVER, RIDE, 1)).rejects.toThrow(
        /later stop/,
      );

      const twice = make({ stops: [stop(1, { arrivedAt: minutesAgo(1) })] });
      await expect(twice.service.arriveAtStop(DRIVER, RIDE, 1)).rejects.toThrow(
        'You already arrived at this stop',
      );
    });

    it('lets the driver skip a stop by going on to the next', async () => {
      const { service, prisma, locations } = make({
        stops: [stop(1), stop(2)],
      });
      locations.getLocation.mockResolvedValue({ lat: 31.52, lng: 74.3 });
      await service.arriveAtStop(DRIVER, RIDE, 2);
      expect(prisma.rideStop.updateMany).toHaveBeenCalledTimes(1);
    });

    it('needs the ride to be under way, and the stop to exist', async () => {
      const before = make({ stops: [stop(1)], ride: { status: 'arrived' } });
      await expect(
        before.service.arriveAtStop(DRIVER, RIDE, 1),
      ).rejects.toBeInstanceOf(ConflictException);
      const missing = make({ stops: [stop(1)] });
      await expect(
        missing.service.arriveAtStop(DRIVER, RIDE, 4),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('leaving a stop', () => {
    it('charges every minute begun after the free ones, at the quoted rate', async () => {
      const { service, prisma, events } = make({
        stops: [stop(1, { arrivedAt: minutesAgo(7) })],
      });
      await service.leaveStop(DRIVER, RIDE, 1);
      // 7 minutes stood, 3 free: 4 minutes at Rs 10.
      expect(prisma.rideStop.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', departedAt: null },
        data: { departedAt: NOW, waitedSeconds: 420, waitingCharge: 40 },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'ride.stop_departed',
        expect.objectContaining({ position: 1 }),
      );
    });

    it('needs Arrived first, and only once', async () => {
      const notThere = make({ stops: [stop(1)] });
      await expect(notThere.service.leaveStop(DRIVER, RIDE, 1)).rejects.toThrow(
        'Press Arrived at this stop first',
      );
      const left = make({
        stops: [
          stop(1, { arrivedAt: minutesAgo(5), departedAt: minutesAgo(1) }),
        ],
      });
      await expect(left.service.leaveStop(DRIVER, RIDE, 1)).rejects.toThrow(
        'You already left this stop',
      );
    });
  });

  describe('completing a ride with stops', () => {
    it('adds the waiting to an agreed price, leaving a stop the driver is still at', async () => {
      const { service, prisma, earnings } = make({
        ride: { negotiable: true, fare: 1000 },
        stops: [
          stop(1, {
            arrivedAt: minutesAgo(15),
            departedAt: minutesAgo(8),
            waitedSeconds: 420,
            waitingCharge: 40,
          }),
          // Still there: 5 minutes, 3 free, Rs 20.
          stop(2, { arrivedAt: minutesAgo(5) }),
        ],
      });
      await service.complete(DRIVER, RIDE);

      const completed = (prisma.ride.updateMany.mock.calls[0] as any[])[0];
      expect(completed.data).toMatchObject({ fare: 1060, waitingCharge: 60 });
      expect(prisma.rideStop.updateMany).toHaveBeenCalledWith({
        where: { id: 's2', departedAt: null },
        data: { departedAt: NOW, waitedSeconds: 300, waitingCharge: 20 },
      });
      expect(earnings.recordRideFare).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ amount: 1060 }),
      );
    });

    it('meters the trip without the time stood at stops, then adds the waiting', async () => {
      const { service, prisma } = make({
        stops: [
          stop(1, {
            arrivedAt: minutesAgo(18),
            departedAt: minutesAgo(10),
            waitedSeconds: 480,
            waitingCharge: 50,
          }),
        ],
      });
      await service.complete(DRIVER, RIDE);
      // 20 minutes on the trip, 8 of them stood at the stop: 100 + 12 x 10,
      // then the stop's Rs 50.
      const completed = (prisma.ride.updateMany.mock.calls[0] as any[])[0];
      expect(completed.data).toMatchObject({ fare: 270, waitingCharge: 50 });
    });

    it('leaves a ride without stops as it was', async () => {
      const { service, prisma } = make({ stops: [] });
      await service.complete(DRIVER, RIDE);
      const completed = (prisma.ride.updateMany.mock.calls[0] as any[])[0];
      expect(completed.data.fare).toBe(300);
      expect(completed.data).not.toHaveProperty('waitingCharge');
    });
  });
});
