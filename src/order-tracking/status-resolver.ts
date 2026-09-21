export interface StatusRef {
  key: string;
  aliases: string[];
  active: boolean;
}

// "In Transit", "in-transit" and "IN_TRANSIT" are the same word.
export const normalizeStatusName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

// Turns whatever the other system calls a step into our status key, or null if
// it is not a step we know (or the step is switched off).
export function resolveStatusKey(
  input: string,
  statuses: StatusRef[],
): string | null {
  const wanted = normalizeStatusName(input);
  const live = statuses.filter((s) => s.active);
  const byKey = live.find((s) => s.key === wanted);
  if (byKey) return byKey.key;
  const byAlias = live.find((s) =>
    s.aliases.some((a) => normalizeStatusName(a) === wanted),
  );
  return byAlias?.key ?? null;
}

// Names (as keys or aliases) that another step already answers to, so two steps
// can never claim the same word.
export function nameConflicts(
  key: string,
  aliases: string[],
  others: StatusRef[],
): string[] {
  const taken = new Set(
    others
      .filter((s) => s.key !== key)
      .flatMap((s) => [s.key, ...s.aliases.map(normalizeStatusName)]),
  );
  return [key, ...aliases.map(normalizeStatusName)].filter((n) => taken.has(n));
}
