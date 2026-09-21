import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursor', () => {
  it('round-trips a time and an id', () => {
    const at = new Date('2026-09-21T10:00:00.123Z');
    const back = decodeCursor(encodeCursor(at, 'abc-123'));
    expect(back?.at.toISOString()).toBe('2026-09-21T10:00:00.123Z');
    expect(back?.id).toBe('abc-123');
  });

  it('treats junk, empty and missing values as "start from the top"', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(Buffer.from('nan_x').toString('base64url'))).toBeNull();
  });
});
