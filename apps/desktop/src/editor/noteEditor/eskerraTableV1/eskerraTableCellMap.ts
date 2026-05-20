import {parseEskerraTableV1FromLines, tokenizeDelimitedRowInner} from '@eskerra/core';
import {type Text} from '@codemirror/state';

import {type EskerraTableDocBlock} from './eskerraTableV1DocBlocks';

/**
 * One cell’s span between pipe delimiters (full segment, for hit-testing the caret)
 * plus the trimmed interior (for active-cell decoration).
 */
export type EskerraTableCellMapping = {
  logicalRow: number;
  col: number;
  /** Inclusive start of the segment between `|` … `|`; cursor here belongs to this cell. */
  from: number;
  /** Exclusive end of that segment. */
  to: number;
  interiorFrom: number;
  interiorTo: number;
};

function mappingsForDelimitedLine(
  lineText: string,
  lineFrom: number,
  logicalRow: number,
): EskerraTableCellMapping[] | null {
  if (!lineText.startsWith('|') || !lineText.endsWith('|')) {
    return null;
  }
  const inner = lineText.slice(1, -1);
  const tokens = tokenizeDelimitedRowInner(inner);
  const out: EskerraTableCellMapping[] = [];
  for (let col = 0; col < tokens.length; col += 1) {
    const token = tokens[col]!;
    const part = token.raw;
    const lead = part.length - part.trimStart().length;
    const trimContent = part.trim();
    const zoneFrom = lineFrom + 1 + token.rawStart;
    const zoneTo = lineFrom + 1 + token.rawEnd;
    const interiorFrom = zoneFrom + lead;
    const interiorTo = interiorFrom + trimContent.length;
    out.push({
      logicalRow,
      col,
      from: zoneFrom,
      to: zoneTo,
      interiorFrom,
      interiorTo,
    });
  }
  return out;
}

/**
 * Maps logical Eskerra v1 table cells to document ranges. Returns `null` if the block
 * does not parse or line shapes disagree with the model column count.
 */
export function buildEskerraTableCellMappings(
  doc: Text,
  block: Pick<EskerraTableDocBlock, 'from' | 'to'>,
): EskerraTableCellMapping[] | null {
  const rawLines = doc.sliceString(block.from, block.to).split('\n');
  const parsed = parseEskerraTableV1FromLines(rawLines);
  if (!parsed.ok) {
    return null;
  }
  const colCount = parsed.model.cells[0]?.length ?? 0;
  if (colCount < 1) {
    return null;
  }

  const startLine = doc.lineAt(block.from).number;
  const endLine = doc.lineAt(block.to).number;
  const out: EskerraTableCellMapping[] = [];

  for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
    const line = doc.line(lineNo);
    const rel = lineNo - startLine;
    if (rel === 1) {
      continue;
    }
    const logicalRow = rel === 0 ? 0 : rel - 1;
    const rowMaps = mappingsForDelimitedLine(line.text, line.from, logicalRow);
    if (!rowMaps || rowMaps.length !== colCount) {
      return null;
    }
    out.push(...rowMaps);
  }
  return out;
}

/** Logical row count (header = 0); separator line is not counted. */
export function eskerraTableLogicalRowCount(mappings: EskerraTableCellMapping[]): number {
  let max = -1;
  for (const m of mappings) {
    max = Math.max(max, m.logicalRow);
  }
  return max + 1;
}

export function findCellMappingAtPos(
  pos: number,
  mappings: EskerraTableCellMapping[],
): EskerraTableCellMapping | null {
  for (const m of mappings) {
    if (pos >= m.from && pos <= m.to) {
      return m;
    }
  }
  return null;
}

export function findCellMappingByLogicalCoords(
  mappings: EskerraTableCellMapping[],
  logicalRow: number,
  col: number,
): EskerraTableCellMapping | null {
  return (
    mappings.find(m => m.logicalRow === logicalRow && m.col === col) ?? null
  );
}
