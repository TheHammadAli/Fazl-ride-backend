import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { ActivityItem, ActivityProvider } from './activity.types.js';

@Injectable()
export class ActivityService {
  private readonly providers = new Map<string, ActivityProvider>();

  // Modules call this once when they start; the feed then includes them.
  register(provider: ActivityProvider) {
    this.providers.set(provider.type, provider);
  }

  get types() {
    return [...this.providers.keys()];
  }

  // Merges every registered source into one list, newest first, page by page.
  async feed(
    userId: string,
    opts: {
      type?: string;
      as: 'passenger' | 'driver';
      limit: number;
      cursor?: string;
    },
  ) {
    const before = decodeCursor(opts.cursor);
    const wanted =
      !opts.type || opts.type === 'all'
        ? [...this.providers.values()]
        : [this.providers.get(opts.type)].filter(
            (p): p is ActivityProvider => !!p,
          );

    // Each source returns its own newest `limit` items; the merged top `limit`
    // is always inside their union, so nothing is skipped between pages.
    const lists = await Promise.all(
      wanted.map((p) =>
        p.list({ userId, as: opts.as, limit: opts.limit + 1, before }),
      ),
    );
    const merged = lists
      .flat()
      .sort(
        (a: ActivityItem, b: ActivityItem) =>
          b.occurredAt.getTime() - a.occurredAt.getTime() ||
          (a.id < b.id ? 1 : -1),
      );
    const page = merged.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        merged.length > opts.limit && last
          ? encodeCursor(last.occurredAt, last.id)
          : null,
    };
  }
}
