import { normalizePkPhone } from './phone.js';

describe('normalizePkPhone', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['+923001234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['00923001234567', '+923001234567'],
    ['0300-123 4567', '+923001234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePkPhone(input)).toBe(expected);
  });

  it.each(['', '12345', '+15551234567', '0400123456', '030012345678'])(
    'rejects %s',
    (input) => {
      expect(normalizePkPhone(input)).toBeNull();
    },
  );
});
