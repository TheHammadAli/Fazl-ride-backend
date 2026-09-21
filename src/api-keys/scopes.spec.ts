import { hasScope, SCOPE_PATTERN } from './scopes.js';

describe('hasScope', () => {
  it('matches exact, resource wildcard and global wildcard', () => {
    expect(hasScope(['parking:write'], 'parking:write')).toBe(true);
    expect(hasScope(['parking:*'], 'parking:read')).toBe(true);
    expect(hasScope(['*'], 'orders:write')).toBe(true);
  });

  it('does not leak across resources or actions', () => {
    expect(hasScope(['parking:read'], 'parking:write')).toBe(false);
    expect(hasScope(['parking:*'], 'orders:read')).toBe(false);
    expect(hasScope([], 'parking:read')).toBe(false);
  });
});

describe('SCOPE_PATTERN', () => {
  it.each(['parking:read', 'order_tracking:write', 'rides:*', '*'])(
    'accepts %s',
    (s) => {
      expect(SCOPE_PATTERN.test(s)).toBe(true);
    },
  );
  it.each(['parking', 'Parking:read', 'parking:delete', ':read', 'a:b:c'])(
    'rejects %s',
    (s) => {
      expect(SCOPE_PATTERN.test(s)).toBe(false);
    },
  );
});
