import {
  DEFAULT_REQUIRED_DOCUMENTS,
  PLATE_REGEX,
  ageOn,
  findMissingDocuments,
  findMissingProfile,
  isExpired,
  isFullName,
  isLicenseNumber,
  normalizePlate,
  parseRequiredDocuments,
  withoutFixed,
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
      'license_back',
      'selfie',
      'vehicle_registration',
      'vehicle_registration',
      'vehicle_photo',
      'vehicle_photo',
    ]);
  });

  it('needs a registration and a photo per vehicle', () => {
    const docs = [
      { type: 'cnic_front', vehicleId: null },
      { type: 'cnic_back', vehicleId: null },
      { type: 'license_front', vehicleId: null },
      { type: 'license_back', vehicleId: null },
      { type: 'selfie', vehicleId: null },
      { type: 'vehicle_registration', vehicleId: 'v1' },
      { type: 'vehicle_photo', vehicleId: 'v1' },
      { type: 'vehicle_photo', vehicleId: 'v2' },
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

describe('findMissingProfile', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  const complete = {
    user: { name: 'Ali Khan', avatarKey: 'users/1/avatar.jpg' },
    profile: {
      dateOfBirth: new Date('1995-05-01'),
      licenseExpiry: new Date('2028-01-01'),
      emergencyContact: '+923001234567',
    },
  };

  it('is empty for a complete profile', () => {
    expect(findMissingProfile(complete.user, complete.profile, now)).toEqual(
      [],
    );
  });

  it('lists everything a driver approved before the rules still lacks', () => {
    expect(
      findMissingProfile(
        { name: '  ', avatarKey: null },
        { dateOfBirth: null, licenseExpiry: null, emergencyContact: null },
        now,
      ),
    ).toEqual([
      'name',
      'avatar',
      'dateOfBirth',
      'licenseExpiry',
      'emergencyContact',
    ]);
  });

  it('flags a licence that expired after approval', () => {
    expect(
      findMissingProfile(
        complete.user,
        { ...complete.profile, licenseExpiry: new Date('2026-10-01') },
        now,
      ),
    ).toEqual(['licenseExpired']);
  });

  it('accepts a licence that expires today', () => {
    expect(isExpired(new Date('2026-10-02'), now)).toBe(false);
    expect(isExpired(new Date('2026-10-01'), now)).toBe(true);
  });
});

describe('ageOn', () => {
  it('counts a birthday only once it has passed', () => {
    const now = new Date('2026-10-02T10:00:00Z');
    expect(ageOn(new Date('2008-10-02'), now)).toBe(18);
    expect(ageOn(new Date('2008-10-03'), now)).toBe(17);
    expect(ageOn(new Date('2008-11-01'), now)).toBe(17);
  });
});

describe('format checks', () => {
  it('wants a real full name, not a few random letters', () => {
    expect(isFullName('Muhammad Ali Khan')).toBe(true);
    expect(isFullName("M. Ali D'Souza")).toBe(true);
    expect(isFullName('علی خان')).toBe(true);
    expect(isFullName('abc')).toBe(false);
    expect(isFullName('Ali')).toBe(false);
    expect(isFullName('Ali 123')).toBe(false);
    expect(isFullName('A B')).toBe(false);
  });

  it('accepts Pakistani plates and rejects junk', () => {
    const ok = (p: string) => PLATE_REGEX.test(normalizePlate(p));
    expect(normalizePlate(' lea  1234 ')).toBe('LEA-1234');
    for (const p of [
      'LEA-1234',
      'lea 1234',
      'LEB 15 1234',
      'ICT AB-123',
      'BFG-12',
      'MIK1213',
    ]) {
      expect(ok(p)).toBe(true);
    }
    for (const p of [
      'abc',
      '123',
      'AB',
      '1234-LEA',
      'LEAAAA-1234',
      'LEA-12345',
    ]) {
      expect(ok(p)).toBe(false);
    }
  });

  it('wants a licence number with real digits in it', () => {
    expect(isLicenseNumber('35202-1234567-1')).toBe(true);
    expect(isLicenseNumber('KHI-DL-778210')).toBe(true);
    expect(isLicenseNumber('abc')).toBe(false);
    expect(isLicenseNumber('ABCDE12')).toBe(false);
    expect(isLicenseNumber('12 34 56')).toBe(false);
  });
});

describe('withoutFixed', () => {
  const issues = [
    { field: 'cnic_front' as const, message: 'Blurry photo' },
    {
      field: 'vehicle_photo' as const,
      message: 'Plate not visible',
      vehicleId: 'v1',
    },
    {
      field: 'vehicle_photo' as const,
      message: 'Plate not visible',
      vehicleId: 'v2',
    },
    { field: 'licenseExpiry' as const, message: 'Does not match the licence' },
  ];

  it('drops only what was fixed, per vehicle', () => {
    expect(
      withoutFixed(issues, [
        { field: 'cnic_front' },
        { field: 'vehicle_photo', vehicleId: 'v2' },
      ]).map((i) => `${i.field}${i.vehicleId ?? ''}`),
    ).toEqual(['vehicle_photov1', 'licenseExpiry']);
  });

  it('keeps everything when nothing flagged was touched', () => {
    expect(withoutFixed(issues, [{ field: 'name' }])).toHaveLength(4);
  });
});
