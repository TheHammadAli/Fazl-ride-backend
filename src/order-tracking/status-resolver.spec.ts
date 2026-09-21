import {
  nameConflicts,
  normalizeStatusName,
  resolveStatusKey,
  StatusRef,
} from './status-resolver.js';

const statuses: StatusRef[] = [
  { key: 'in_transit', aliases: ['DISPATCHED', 'On the way'], active: true },
  { key: 'delivered', aliases: ['COMPLETED'], active: true },
  { key: 'near_destination', aliases: [], active: false },
];

describe('resolveStatusKey', () => {
  it('accepts our own keys however they are written', () => {
    expect(resolveStatusKey('in_transit', statuses)).toBe('in_transit');
    expect(resolveStatusKey('In Transit', statuses)).toBe('in_transit');
    expect(resolveStatusKey('in-transit', statuses)).toBe('in_transit');
    expect(resolveStatusKey('  IN_TRANSIT ', statuses)).toBe('in_transit');
  });

  it("maps the other system's own names through aliases", () => {
    expect(resolveStatusKey('DISPATCHED', statuses)).toBe('in_transit');
    expect(resolveStatusKey('dispatched', statuses)).toBe('in_transit');
    expect(resolveStatusKey('on the way', statuses)).toBe('in_transit');
    expect(resolveStatusKey('Completed', statuses)).toBe('delivered');
  });

  it('does not know a step that is unknown or switched off', () => {
    expect(resolveStatusKey('teleported', statuses)).toBeNull();
    expect(resolveStatusKey('near_destination', statuses)).toBeNull();
    expect(resolveStatusKey('', statuses)).toBeNull();
  });
});

describe('nameConflicts', () => {
  it('reports a word another step already answers to', () => {
    expect(nameConflicts('preparing', ['dispatched'], statuses)).toEqual([
      'dispatched',
    ]);
    expect(nameConflicts('delivered_ok', ['COMPLETED'], statuses)).toEqual([
      'completed',
    ]);
    expect(nameConflicts('in_transit', [], statuses)).toEqual([]); // a step never conflicts with itself
  });

  it('is fine when every word is new', () => {
    expect(nameConflicts('preparing', ['cooking'], statuses)).toEqual([]);
  });

  it('normalises before comparing', () => {
    expect(normalizeStatusName(' On The-Way ')).toBe('on_the_way');
  });
});
