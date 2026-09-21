import {
  DEFAULT_REQUIRED_DOCUMENTS,
  findMissingDocuments,
  parseRequiredDocuments,
} from './driver-requirements.js';

describe('parseRequiredDocuments', () => {
  it('uses the defaults when unset', () => {
    expect(parseRequiredDocuments(undefined)).toEqual(
      DEFAULT_REQUIRED_DOCUMENTS,
    );
    expect(parseRequiredDocuments('  ')).toEqual(DEFAULT_REQUIRED_DOCUMENTS);
  });

  it('accepts an override list', () => {
    expect(parseRequiredDocuments('cnic_front, selfie')).toEqual([
      'cnic_front',
      'selfie',
    ]);
  });

  it('rejects unknown types so a typo cannot silently disable the rule', () => {
    expect(() => parseRequiredDocuments('cnic_front,passport')).toThrow(
      /passport/,
    );
  });
});

describe('findMissingDocuments', () => {
  const vehicles = [{ id: 'v1' }, { id: 'v2' }];

  it('reports everything when nothing was uploaded', () => {
    const missing = findMissingDocuments(
      DEFAULT_REQUIRED_DOCUMENTS,
      vehicles,
      [],
    );
    expect(missing.map((m) => m.type)).toEqual([
      'cnic_front',
      'cnic_back',
      'license_front',
      'selfie',
      'vehicle_registration',
      'vehicle_registration',
    ]);
  });

  it('needs a registration per vehicle', () => {
    const docs = [
      { type: 'cnic_front', vehicleId: null },
      { type: 'cnic_back', vehicleId: null },
      { type: 'license_front', vehicleId: null },
      { type: 'selfie', vehicleId: null },
      { type: 'vehicle_registration', vehicleId: 'v1' },
    ] as const;
    expect(
      findMissingDocuments(DEFAULT_REQUIRED_DOCUMENTS, vehicles, [...docs]),
    ).toEqual([{ type: 'vehicle_registration', vehicleId: 'v2' }]);
  });

  it('ignores vehicle registrations when they are not required', () => {
    expect(findMissingDocuments(['selfie'], vehicles, [])).toEqual([
      { type: 'selfie' },
    ]);
  });
});
