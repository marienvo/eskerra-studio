/**
 * GFM pipe-table cell tokenizer for Eskerra table v1.
 *
 * Only `\|` is treated as an escaped literal pipe inside a cell (not a column
 * delimiter). Sequences like `\\|` are read as `\` + escaped pipe.
 * Serialized cells may double literal backslashes before a pipe, so `\\\|` is
 * also decoded as `\|`.
 *
 * Backslashes that are not part of a pipe escape are preserved literally. That
 * avoids silently mutating older vault notes, which stored user-entered
 * backslashes without any table-specific escaping.
 */

/** Decode escaped literal pipes while preserving all other backslashes. */
export function decodeCellEscapes(raw: string): string {
  let decoded = '';
  let backslashRunLength = 0;

  for (const char of raw) {
    if (char === '\\') {
      backslashRunLength += 1;
      continue;
    }

    if (char === '|' && backslashRunLength > 0) {
      decoded += '\\'.repeat(Math.floor(backslashRunLength / 2));
      decoded += '|';
      backslashRunLength = 0;
      continue;
    }

    if (backslashRunLength > 0) {
      decoded += '\\'.repeat(backslashRunLength);
      backslashRunLength = 0;
    }
    decoded += char;
  }

  if (backslashRunLength > 0) {
    decoded += '\\'.repeat(backslashRunLength);
  }
  return decoded;
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
