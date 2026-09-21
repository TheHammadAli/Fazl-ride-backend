import { tokenFromHandshake } from './realtime-auth.service.js';

describe('tokenFromHandshake', () => {
  it('prefers the auth payload the Flutter client sends', () => {
    expect(
      tokenFromHandshake({ auth: { token: 'abc.def.ghi' }, headers: {} }),
    ).toBe('abc.def.ghi');
  });

  it('accepts a "Bearer " prefix in either place', () => {
    expect(tokenFromHandshake({ auth: { token: 'Bearer abc.def' } })).toBe(
      'abc.def',
    );
    expect(
      tokenFromHandshake({ headers: { authorization: 'Bearer xyz.123' } }),
    ).toBe('xyz.123');
    expect(
      tokenFromHandshake({ headers: { authorization: 'bearer xyz.123' } }),
    ).toBe('xyz.123');
  });

  it('returns null when there is no usable token', () => {
    expect(tokenFromHandshake({})).toBeNull();
    expect(tokenFromHandshake({ auth: { token: '' }, headers: {} })).toBeNull();
    expect(tokenFromHandshake({ auth: { token: 42 } })).toBeNull();
    expect(
      tokenFromHandshake({ headers: { authorization: 'Basic abc' } }),
    ).toBeNull();
    expect(
      tokenFromHandshake({ headers: { authorization: 'Bearer ' } }),
    ).toBeNull();
  });
});
