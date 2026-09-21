import { ActivityService } from './activity.service.js';
import {
  ActivityItem,
  ActivityProvider,
  ActivityQuery,
} from './activity.types.js';

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 8, 21, 12, 0, 0) - minutes * 60_000);
const item = (type: string, id: string, minutesAgo: number): ActivityItem => ({
  id,
  type,
  title: id,
  subtitle: null,
  occurredAt: at(minutesAgo),
  status: 'completed',
  amount: null,
  myRating: null,
  ref: { module: type, id },
});

// A fake source that honours `before` and `limit` like a real one must.
function source(type: string, items: ActivityItem[]): ActivityProvider {
  return {
    type,
    async list(q: ActivityQuery) {
      return items
        .filter(
          (i) =>
            !q.before ||
            i.occurredAt < q.before.at ||
            (i.occurredAt.getTime() === q.before.at.getTime() &&
              i.id < q.before.id),
        )
        .sort(
          (a, b) =>
            b.occurredAt.getTime() - a.occurredAt.getTime() ||
            (a.id < b.id ? 1 : -1),
        )
        .slice(0, q.limit);
    },
  };
}

describe('ActivityService', () => {
  const build = () => {
    const service = new ActivityService();
    service.register(
      source('ride', [
        item('ride', 'r1', 5),
        item('ride', 'r2', 30),
        item('ride', 'r3', 90),
      ]),
    );
    service.register(
      source('delivery', [
        item('delivery', 'd1', 10),
        item('delivery', 'd2', 60),
      ]),
    );
    return service;
  };

  it('merges every source, newest first', async () => {
    const { items } = await build().feed('u', { as: 'passenger', limit: 10 });
    expect(items.map((i) => i.id)).toEqual(['r1', 'd1', 'r2', 'd2', 'r3']);
  });

  it('filters by tab, and an unknown or empty tab is simply empty', async () => {
    const service = build();
    expect(
      (await service.feed('u', { type: 'ride', as: 'passenger', limit: 10 }))
        .items,
    ).toHaveLength(3);
    expect(
      (await service.feed('u', { type: 'parking', as: 'passenger', limit: 10 }))
        .items,
    ).toEqual([]);
  });

  it('pages through everything exactly once with the cursor', async () => {
    const service = build();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.feed('u', {
        as: 'passenger',
        limit: 2,
        cursor,
      });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['r1', 'd1', 'r2', 'd2', 'r3']);
  });

  it('has no next cursor on the last page', async () => {
    const page = await build().feed('u', { as: 'passenger', limit: 5 });
    expect(page.nextCursor).toBeNull();
  });

  it('keeps items that share the exact same time in a stable order across pages', async () => {
    const service = new ActivityService();
    service.register(
      source('ride', [
        item('ride', 'a', 10),
        item('ride', 'b', 10),
        item('ride', 'c', 10),
      ]),
    );
    const first = await service.feed('u', { as: 'passenger', limit: 2 });
    const second = await service.feed('u', {
      as: 'passenger',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('a new module shows up just by registering', async () => {
    const service = build();
    service.register(source('parking', [item('parking', 'p1', 1)]));
    const { items } = await service.feed('u', { as: 'passenger', limit: 10 });
    expect(items[0].id).toBe('p1');
    expect(service.types).toContain('parking');
  });
});
