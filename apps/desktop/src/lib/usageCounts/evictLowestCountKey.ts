/**
 * Drop one existing key with the lowest count (lexicographically smallest key on ties).
 * Call only when `map.size >= maxKeys` and a new key will be added.
 */
export function evictLowestCountKey(map: Map<string, number>, maxKeys: number): void {
  if (map.size < maxKeys) {
    return;
  }
  let victim: string | null = null;
  let victimCount = Number.POSITIVE_INFINITY;
  for (const [k, n] of map) {
    if (
      victim === null
      || n < victimCount
      || (n === victimCount && k.localeCompare(victim) < 0)
    ) {
      victim = k;
      victimCount = n;
    }
  }
  if (victim !== null) {
    map.delete(victim);
  }
}
