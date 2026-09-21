import { buildTimeline, StatusStep } from './timeline.js';

const step = (
  key: string,
  position: number,
  terminal = false,
  active = true,
): StatusStep => ({
  key,
  label: key,
  position,
  terminal,
  active,
});
const steps = [
  step('confirmed', 10),
  step('preparing', 20),
  step('in_transit', 30),
  step('delivered', 40, true),
  step('cancelled', 50, true),
];
const at = (m: number) => new Date(Date.UTC(2026, 8, 21, 10, m));

describe('buildTimeline', () => {
  it('shows every normal step, the last one still waiting', () => {
    const t = buildTimeline(
      steps,
      [
        { statusKey: 'confirmed', at: at(0) },
        { statusKey: 'preparing', at: at(5) },
      ],
      'preparing',
    );
    expect(t.map((e) => e.key)).toEqual([
      'confirmed',
      'preparing',
      'in_transit',
      'delivered',
    ]);
    expect(t.map((e) => e.done)).toEqual([true, true, false, false]);
    expect(t.find((e) => e.current)?.key).toBe('preparing');
    expect(t[0].reachedAt).toEqual(at(0));
    expect(t[2].reachedAt).toBeNull();
  });

  it('hides "cancelled" unless the order was cancelled', () => {
    expect(
      buildTimeline(steps, [], 'confirmed').some((e) => e.key === 'cancelled'),
    ).toBe(false);
    const t = buildTimeline(
      steps,
      [
        { statusKey: 'confirmed', at: at(0) },
        { statusKey: 'cancelled', at: at(9) },
      ],
      'cancelled',
    );
    expect(t.map((e) => e.key)).toContain('cancelled');
    expect(t.find((e) => e.key === 'cancelled')?.current).toBe(true);
  });

  it('counts a skipped step as done even without a time', () => {
    const t = buildTimeline(
      steps,
      [
        { statusKey: 'confirmed', at: at(0) },
        { statusKey: 'in_transit', at: at(20) },
      ],
      'in_transit',
    );
    const prep = t.find((e) => e.key === 'preparing')!;
    expect(prep.done).toBe(true);
    expect(prep.reachedAt).toBeNull();
  });

  it('follows the position an admin gives, not the order they were created', () => {
    const shuffled = [step('b', 20), step('a', 10), step('done', 30, true)];
    expect(buildTimeline(shuffled, [], 'a').map((e) => e.key)).toEqual([
      'a',
      'b',
      'done',
    ]);
  });

  it('leaves out a step an admin switched off (but keeps the current one)', () => {
    const off = [
      step('a', 10),
      step('b', 20, false, false),
      step('done', 30, true),
    ];
    expect(buildTimeline(off, [], 'a').map((e) => e.key)).toEqual([
      'a',
      'done',
    ]);
    expect(buildTimeline(off, [], 'b').map((e) => e.key)).toEqual([
      'a',
      'b',
      'done',
    ]);
  });

  it('uses the latest time when a step was reported twice', () => {
    const t = buildTimeline(
      steps,
      [
        { statusKey: 'confirmed', at: at(1) },
        { statusKey: 'confirmed', at: at(3) },
      ],
      'confirmed',
    );
    expect(t[0].reachedAt).toEqual(at(3));
  });
});
