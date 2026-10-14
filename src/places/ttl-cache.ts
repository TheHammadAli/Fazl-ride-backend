// A small in-memory cache with an expiry per entry and a size cap (oldest
// entry dropped first). Per instance; enough to stop paying Google twice for
// the same answer within minutes.
export class TtlCache<V> {
  private readonly map = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, { at: Date.now(), value });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}
