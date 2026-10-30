import { describe, expect, it } from 'vitest';
import { temporaryPassword } from './temporary-password.js';

describe('temporaryPassword', () => {
  it('is long enough and avoids look-alike characters', () => {
    for (let i = 0; i < 50; i++) {
      const p = temporaryPassword();
      expect(p).toHaveLength(14);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });
  it('differs every time', () => {
    expect(temporaryPassword()).not.toBe(temporaryPassword());
  });
});
