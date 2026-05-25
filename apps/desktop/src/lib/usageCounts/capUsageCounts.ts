/** Keep top `maxKeys` entries by count (then key) when trimming loaded data. */
export function capUsageCounts(
  raw: Readonly<Record<string, number>>,
  maxKeys: number,
  normalizeItemKey: (key: string) => string,
): Record<string, number> {
  const entries = Object.entries(raw).filter(
    ([k, n]) =>
      typeof k === 'string'
      && k.length > 0
      && typeof n === 'number'
      && Number.isFinite(n)
      && n > 0,
  );
  if (entries.length <= maxKeys) {
    const out: Record<string, number> = {};
    for (const [k, n] of entries) {
      out[normalizeItemKey(k)] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
    }
    return out;
  }
  entries.sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  const out: Record<string, number> = {};
  for (const [k, n] of entries.slice(0, maxKeys)) {
    out[normalizeItemKey(k)] = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
  }
  return out;
}
