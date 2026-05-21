import type {EskerraTableAlignment, EskerraTableModelV1} from './model';

function escapeCellPipes(cell: string): string {
  return cell.trim().replace(/\\*\|/g, match => {
    const backslashes = match.slice(0, -1);
    return `${'\\'.repeat(backslashes.length * 2)}\\|`;
  });
}

function serializeRow(cells: string[]): string {
  return `| ${cells.map(escapeCellPipes).join(' | ')} |`;
}

function normalizeAlignment(value: EskerraTableAlignment): string {
  switch (value) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

function ensureRectangular(model: EskerraTableModelV1): number {
  if (model.cells.length < 1) {
    throw new Error('Eskerra table model must include a header row.');
  }
  const width = model.cells[0]!.length;
  if (width < 1) {
    throw new Error('Eskerra table model must include at least one column.');
  }

  for (const row of model.cells) {
    if (row.length !== width) {
      throw new Error('Eskerra table model rows must be rectangular.');
    }
    for (const cell of row) {
      if (cell.includes('\n') || cell.includes('\r')) {
        throw new Error('Eskerra table v1 does not support newlines inside cells.');
      }
    }
  }
  return width;
}

/**
 * Deterministic v1 markdown serializer. Output normalization is intentional:
 * fixed outer pipes, fixed inter-cell spaces, canonical alignment row, LF newlines.
 */
export function serializeEskerraTableV1ToMarkdown(model: EskerraTableModelV1): string {
  const width = ensureRectangular(model);
  const header = serializeRow(model.cells[0]!);
  const separator = serializeRow(
    Array.from({length: width}, (_, i) => normalizeAlignment(model.align[i])),
  );
  const body = model.cells.slice(1).map(serializeRow);
  return [header, separator, ...body].join('\n');
}
