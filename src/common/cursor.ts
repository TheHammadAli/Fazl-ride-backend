// Keyset pagination cursor: the time and id of the last item seen. Using both
// keeps the order stable when several items share the same timestamp.
export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}_${id}`).toString('base64url');
}

export function decodeCursor(raw?: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const [ms, id] = Buffer.from(raw, 'base64url').toString().split('_');
    const at = new Date(Number(ms));
    return Number.isFinite(at.getTime()) && id ? { at, id } : null;
  } catch {
    return null;
  }
}
