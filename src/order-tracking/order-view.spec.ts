import { presentOrder, OrderWithStatus } from './order-view.js';

const status = (terminal: boolean, key = 'in_transit') => ({
  key,
  label: key,
  position: terminal ? 80 : 60,
  terminal,
  active: true,
  aliases: [],
  updatedAt: new Date(),
});

function order(over: Partial<OrderWithStatus> = {}): OrderWithStatus {
  return {
    id: 'o1',
    source: 'fazl',
    externalId: 'ORD-1',
    customerRef: 'cust-9',
    customerPhone: '+923001112233',
    pickupAddress: 'Shop',
    pickupLat: 31.5,
    pickupLng: 74.3,
    deliveryAddress: 'Home',
    deliveryLat: 31.4,
    deliveryLng: 74.4,
    statusKey: 'in_transit',
    status: status(false),
    deliveryPersonId: 'r-1',
    deliveryPersonName: 'Ali Raza',
    deliveryPersonPhone: '+923009998877',
    deliveryPersonPhotoUrl: 'https://img.example/ali.jpg',
    deliveryPersonRating: 4.8,
    vehicleType: 'car',
    vehicleMake: 'Honda',
    vehicleModel: 'Civic',
    vehicleColor: 'Black',
    vehiclePlate: 'LEA 5678',
    lastLat: 31.45,
    lastLng: 74.35,
    lastHeading: 90,
    lastLocationAt: new Date(),
    etaSeconds: 300,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as OrderWithStatus;
}
const ctx = {
  steps: [],
  events: [],
  distanceRemainingMeters: 1800,
  etaSeconds: 300,
};

describe('presentOrder', () => {
  it('shows the delivery person, vehicle, live location and ETA while the order is on its way', () => {
    const v = presentOrder(order(), ctx);
    expect(v.deliveryPerson?.name).toBe('Ali Raza');
    expect(v.deliveryPerson?.phone).toBe('+923009998877');
    expect(v.deliveryPerson?.vehicle?.plate).toBe('LEA 5678');
    expect(v.location?.lat).toBe(31.45);
    expect(v.etaSeconds).toBe(300);
    expect(v.distanceRemainingMeters).toBe(1800);
  });

  it('never exposes the customer contact details', () => {
    const json = JSON.stringify(presentOrder(order(), ctx));
    expect(json).not.toContain('+923001112233');
    expect(json).not.toContain('cust-9');
    expect(json).not.toContain('customerPhone');
  });

  it('once finished: no phone, no live location, no ETA, no distance', () => {
    const v = presentOrder(
      order({ status: status(true, 'delivered'), statusKey: 'delivered' }),
      ctx,
    );
    expect(v.status.finished).toBe(true);
    expect(v.deliveryPerson?.phone).toBeNull();
    expect(v.deliveryPerson?.name).toBe('Ali Raza'); // the name stays for the receipt
    expect(v.location).toBeNull();
    expect(v.etaSeconds).toBeNull();
    expect(v.distanceRemainingMeters).toBeNull();
  });

  it('before anyone is assigned: no person, no vehicle, no location', () => {
    const v = presentOrder(
      order({
        deliveryPersonId: null,
        deliveryPersonName: null,
        deliveryPersonPhone: null,
        deliveryPersonPhotoUrl: null,
        vehicleType: null,
        vehicleMake: null,
        vehicleModel: null,
        vehiclePlate: null,
        lastLat: null,
        lastLng: null,
      }),
      { ...ctx, etaSeconds: null, distanceRemainingMeters: null },
    );
    expect(v.deliveryPerson).toBeNull();
    expect(v.location).toBeNull();
  });

  it('leaves out the pickup when the other system did not send one', () => {
    expect(
      presentOrder(order({ pickupLat: null, pickupLng: null }), ctx).pickup,
    ).toBeNull();
  });
});
