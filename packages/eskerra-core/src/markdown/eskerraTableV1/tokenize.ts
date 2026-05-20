/**
 * GFM pipe-table cell tokenizer for Eskerra table v1.
 *
 * Only `\|` is treated as an escaped literal pipe inside a cell (not a column
 * delimiter). Sequences like `\\|` are read as `\` + escaped pipe.
 * Doubled backslashes (`\\`) decode to a single `\` (inverse of serialize).
 *
 * **Backward compatibility:** vault table cells written before serialize started
 * escaping `\` may have stored a literal pair `\\` (two backslashes). On read,
 * `decodeCellEscapes` collapses each `\\` to `\`, so those cells change in memory
 * and the next save will persist the decoded form. This is intentional (inverse
 * of `escapeCellPipes` in serialize) but can surprise users who relied on `\\`
 * as literal text in old notes.
 */

/** Inverse of serialize cell escaping: decode `\|` then `\\`. */
export function decodeCellEscapes(raw: string): string {
  return raw.replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}
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
        value: decodeCellEscapes(raw),
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
