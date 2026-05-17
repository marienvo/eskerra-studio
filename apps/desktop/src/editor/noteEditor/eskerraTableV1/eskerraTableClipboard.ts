/** Clipboard / paste helpers for Eskerra table edit mode (TSV + HTML tables). */

import {sanitizeClipboardHtml} from '../../../lib/clipboard/sanitizeClipboardHtml';

export function matrixFromTsv(plain: string): string[][] {
  const normalized = plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = normalized.split('\n');
  if (rows.length > 0 && rows[rows.length - 1] === '') {
    rows.pop();
  }
  return rows
    .map(row => row.split('\t'))
    .filter(row => row.length > 0 && (row.length !== 1 || row[0] !== ''));
}

export function matrixFromHtmlTable(html: string): string[][] {
  const parser = new DOMParser();
  const safeHtml = sanitizeClipboardHtml(html);
  const doc = parser.parseFromString(safeHtml, 'text/html');
  const table = doc.querySelector('table');
  if (!table) {
    return [];
  }
  const rows: string[][] = [];
  table.querySelectorAll('tr').forEach(row => {
    const cells = Array.from(row.querySelectorAll('th,td')).map(cell =>
      (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length > 0) {
      rows.push(cells);
    }
  });
  return rows;
}

export function clipboardMatrixFromDataTransfer(dt: DataTransfer | null): string[][] {
  if (!dt) {
    return [];
  }
  const html = dt.getData('text/html');
  if (html.trim() !== '') {
    const fromHtml = matrixFromHtmlTable(html);
    if (fromHtml.length > 0) {
      return fromHtml;
    }
  }
  const plain = dt.getData('text/plain');
  if (plain.trim() === '') {
    return [];
  }
  return matrixFromTsv(plain);
}

export function clipboardMatrixFromClipboardEvent(event: ClipboardEvent): string[][] {
  return clipboardMatrixFromDataTransfer(event.clipboardData);
}
