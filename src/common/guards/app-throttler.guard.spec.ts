import { trackerFor } from './app-throttler.guard.js';

const bearer = (t: string) => `Bearer ${t.repeat(8)}`;

describe('trackerFor', () => {
  it('counts signed-in requests per session, so two phones on one IP do not share a limit', () => {
    const a = trackerFor({
      headers: { authorization: bearer('aaaa') },
      ip: '10.0.0.1',
    });
    const b = trackerFor({
      headers: { authorization: bearer('bbbb') },
      ip: '10.0.0.1',
    });
    expect(a).not.toBe(b);
    expect(a.startsWith('token:')).toBe(true);
  });

  it('is stable for the same session and never contains the token itself', () => {
    const h = { authorization: bearer('cccc') };
    expect(trackerFor({ headers: h, ip: '1.1.1.1' })).toBe(
      trackerFor({ headers: h, ip: '2.2.2.2' }),
    );
    expect(trackerFor({ headers: h })).not.toContain('cccc');
  });

  it('falls back to the IP without a token (login and OTP routes)', () => {
    expect(trackerFor({ headers: {}, ip: '10.0.0.9' })).toBe('ip:10.0.0.9');
    expect(
      trackerFor({ headers: { authorization: 'Basic abc' }, ip: '10.0.0.9' }),
    ).toBe('ip:10.0.0.9');
  });
});
