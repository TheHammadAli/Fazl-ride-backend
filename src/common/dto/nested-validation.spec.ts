import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyDriverDto } from '../../drivers/dto/driver.dto.js';
import { EstimateRideDto } from '../../rides/dto/ride.dto.js';

// class-validator's @ValidateNested() lets a missing object through, which
// used to end in a 500. These make sure a required nested object is rejected.
const errorsFor = (cls: new () => object, plain: object) =>
  validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('required nested objects', () => {
  it('EstimateRideDto rejects a missing dropoff', async () => {
    const errors = await errorsFor(EstimateRideDto, {
      pickup: { lat: 31.5, lng: 74.3 },
    });
    expect(errors.map((e) => e.property)).toContain('dropoff');
  });

  it('EstimateRideDto accepts both points', async () => {
    const errors = await errorsFor(EstimateRideDto, {
      pickup: { lat: 31.5, lng: 74.3 },
      dropoff: { lat: 31.4, lng: 74.4 },
    });
    expect(errors).toHaveLength(0);
  });

  it('ApplyDriverDto rejects a missing vehicle', async () => {
    const errors = await errorsFor(ApplyDriverDto, {
      cnic: '35202-1234567-1',
      licenseNumber: 'LHR-1',
    });
    expect(errors.map((e) => e.property)).toContain('vehicle');
  });

  it('EstimateRideDto accepts the same objects that POST /rides sends (with address)', async () => {
    const errors = await errorsFor(EstimateRideDto, {
      pickup: { lat: 31.5, lng: 74.3, address: 'Liberty Market' },
      dropoff: { lat: 31.4, lng: 74.4, address: 'DHA Phase 5' },
    });
    expect(errors).toHaveLength(0);
  });
});
