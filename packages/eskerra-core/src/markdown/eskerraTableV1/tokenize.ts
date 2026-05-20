/**
 * GFM pipe-table cell tokenizer for Eskerra table v1.
 *
 * Only `\|` is treated as an escaped literal pipe inside a cell (not a column
 * delimiter). Sequences like `\\|` are read as `\` + escaped pipe (v1 has no
 * general backslash escapes).
 */
export type EskerraTableCellToken = {
  /** Inclusive start offset into the inner row (line without outer `|`). */
  rawStart: number;
  /** Exclusive end offset into the inner row. */
  rawEnd: number;
  /** Source slice `inner[rawStart:rawEnd]` (may still contain `\|`). */
  raw: string;
  /** Decoded cell content (`\|` → `|`). */
  value: string;
};

export function tokenizeDelimitedRowInner(inner: string): EskerraTableCellToken[] {
  const tokens: EskerraTableCellToken[] = [];
  let rawStart = 0;
  let i = 0;

  while (i <= inner.length) {
    if (i < inner.length && inner[i] === '\\' && inner[i + 1] === '|') {
      i += 2;
      continue;
    }
    if (i === inner.length || inner[i] === '|') {
      const rawEnd = i;
      const raw = inner.slice(rawStart, rawEnd);
      tokens.push({
        rawStart,
        rawEnd,
        raw,
        value: raw.replace(/\\\|/g, '|'),
      });
      if (i < inner.length) {
        i += 1;
        rawStart = i;
      } else {
        break;
      }
      continue;
    }
    i += 1;
  }

  return tokens;
}
