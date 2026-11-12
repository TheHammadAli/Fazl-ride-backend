import { describe, expect, it } from 'vitest';
import { cleanNote, cleanOptions, cleanRider } from './ride-extras.js';

describe('cleanOptions', () => {
  it('keeps known options in a fixed order without repeats', () => {
    expect(cleanOptions(['pet', 'luggage', 'pet'])).toEqual(['luggage', 'pet']);
  });

  it('is empty when nothing is ticked', () => {
    expect(cleanOptions(undefined)).toEqual([]);
  });
});

describe('cleanNote', () => {
  it('tidies spaces', () => {
    expect(cleanNote('  gate  no.\n 3 ')).toBe('gate no. 3');
  });

  it('turns an empty note into null', () => {
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });
});

describe('cleanRider', () => {
  const own = '+923001234567';

  it('normalizes the number', () => {
    expect(
      cleanRider({ name: ' Ammi  Jaan ', phone: '0321 7654321' }, own),
    ).toEqual({
      name: 'Ammi Jaan',
      phone: '+923217654321',
    });
  });

  it('ignores the customer’s own number', () => {
    expect(cleanRider({ name: 'Me', phone: '03001234567' }, own)).toBeNull();
  });

  it('refuses a number that is not a Pakistani mobile', () => {
    expect(cleanRider({ name: 'X', phone: '12345' }, own)).toBe('bad_phone');
  });

  it('is null when nobody else is riding', () => {
    expect(cleanRider(undefined, own)).toBeNull();
  });
});
