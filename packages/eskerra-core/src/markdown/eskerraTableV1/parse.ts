import type {
  EskerraTableAlignment,
  ParseEskerraTableV1Result,
} from './model';
import {tokenizeDelimitedRowInner} from './tokenize';

type ParsedRow = {
  cells: string[];
};

function parseDelimitedRow(line: string): ParsedRow | null {
  if (!line.startsWith('|') || !line.endsWith('|')) {
    return null;
  }
  const inner = line.slice(1, -1);
  const cells = tokenizeDelimitedRowInner(inner).map(token => token.value.trim());
  if (cells.length < 1) {
    return null;
  }
  return {cells};
}

/**
 * Pipe-table separator cell: optional colons + a run of hyphens.
 * Uses the same minimum as markdown-it's GFM table rule (`^:?-+:?$`): **one or more** hyphens
 * (so `--` and `---` both work). Canonical serialization still emits GFM-style `---` / `:---` tokens.
 */
function parseAlignmentCell(cell: string): EskerraTableAlignment | null {
  const trimmed = cell.trim();
  if (/^:-{1,}:$/.test(trimmed)) {
    return 'center';
  }
  if (/^:-{1,}$/.test(trimmed)) {
    return 'left';
  }
  if (/^-{1,}:$/.test(trimmed)) {
    return 'right';
  }
  if (/^-{1,}$/.test(trimmed)) {
    return undefined;
  }
  return null;
}

/**
 * Parses a strict v1 subset of pipe-table markdown lines.
 * The caller owns candidate detection; this function only validates and decodes.
 */
export function parseEskerraTableV1FromLines(lines: string[]): ParseEskerraTableV1Result {
  if (lines.length < 2) {
    return {ok: false, reason: 'missing_separator'};
  }
  if (lines.every(line => line.trim() === '')) {
    return {ok: false, reason: 'empty'};
  }

  for (const line of lines) {
    if (line.trim() === '') {
      return {ok: false, reason: 'blank_line'};
    }
  }

  const headerRow = parseDelimitedRow(lines[0]!);
  if (!headerRow) {
    return {ok: false, reason: 'invalid_row_shape'};
  }
  const columnCount = headerRow.cells.length;

  const separatorRow = parseDelimitedRow(lines[1]!);
  if (!separatorRow) {
    return {ok: false, reason: 'missing_separator'};
  }
  if (separatorRow.cells.length !== columnCount) {
    return {ok: false, reason: 'column_mismatch'};
  }

  const align: EskerraTableAlignment[] = [];
  for (const cell of separatorRow.cells) {
    const parsed = parseAlignmentCell(cell);
    if (parsed === null) {
      return {ok: false, reason: 'invalid_separator'};
    }
    align.push(parsed);
  }

  const cells = [headerRow.cells];
  for (let i = 2; i < lines.length; i += 1) {
    const row = parseDelimitedRow(lines[i]!);
    if (!row) {
      return {ok: false, reason: 'invalid_row_shape'};
    }
    if (row.cells.length !== columnCount) {
      return {ok: false, reason: 'column_mismatch'};
    }
    cells.push(row.cells);
  }

  return {
    ok: true,
    model: {
      cells,
      align,
    },
    lineCount: lines.length,
  };
}
