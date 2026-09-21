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

describe('trackerFor: integrations and tracking links', () => {
  it('counts an API key on its own, not by the shared server IP', () => {
    const a = trackerFor({
      headers: { 'x-api-key': 'fzl_aaaa_secret1' },
      ip: '10.0.0.5',
    });
    const b = trackerFor({
      headers: { 'x-api-key': 'fzl_bbbb_secret2' },
      ip: '10.0.0.5',
    });
    expect(a.startsWith('apikey:')).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret1');
  });

  it('counts a tracking link on its own', () => {
    const t = trackerFor({
      headers: { 'x-tracking-token': 'trk_abcdefghijkl' },
      ip: '10.0.0.5',
    });
    expect(t.startsWith('track:')).toBe(true);
    expect(t).not.toContain('abcdefghijkl');
  });

  it('a login token still wins over the others', () => {
    const t = trackerFor({
      headers: {
        authorization: 'Bearer ' + 'x'.repeat(30),
        'x-api-key': 'fzl_aaaa_secret1',
      },
    });
    expect(t.startsWith('token:')).toBe(true);
  });
});

describe('AppThrottlerGuard', () => {
  it('lets websocket and other non-HTTP contexts through instead of crashing on them', async () => {
    const { AppThrottlerGuard } = await import('./app-throttler.guard.js');
    const guard = Object.create(AppThrottlerGuard.prototype) as InstanceType<
      typeof AppThrottlerGuard
    >;
    const ws = { getType: () => 'ws' } as any;
    await expect(guard.canActivate(ws)).resolves.toBe(true);
  });
});
