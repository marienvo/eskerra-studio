import {describe, expect, it} from 'vitest';
import {
  matrixFromHtmlTable,
  matrixFromTsv,
  clipboardMatrixFromDataTransfer,
} from './eskerraTableClipboard';

describe('matrixFromTsv', () => {
  it('parses tab-separated rows', () => {
    expect(matrixFromTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('drops trailing empty last line', () => {
    expect(matrixFromTsv('a\tb\n')).toEqual([['a', 'b']]);
  });
});

describe('matrixFromHtmlTable', () => {
  it('reads a simple table', () => {
    const html = `<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`;
    expect(matrixFromHtmlTable(html)).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });

  it('parses table cells after sanitizing untrusted HTML (no script execution path)', () => {
    const html =
      '<script>document.body.dataset.x="bad"</script>' +
      '<table><tr><td>safe</td></tr></table>';
    expect(matrixFromHtmlTable(html)).toEqual([['safe']]);
    expect(document.body.dataset.x).toBeUndefined();
  });
});

describe('clipboardMatrixFromDataTransfer', () => {
  it('prefers HTML table when present', () => {
    const dt = {
      getData: (mime: string) => {
        if (mime === 'text/html') {
          return '<table><tr><td>x</td></tr></table>';
        }
        if (mime === 'text/plain') {
          return 'y';
        }
        return '';
      },
    } as DataTransfer;
    expect(clipboardMatrixFromDataTransfer(dt)).toEqual([['x']]);
  });

  it('falls back to plain TSV', () => {
    const dt = {
      getData: (mime: string) => (mime === 'text/plain' ? 'a\tb' : ''),
    } as DataTransfer;
    expect(clipboardMatrixFromDataTransfer(dt)).toEqual([['a', 'b']]);
  });
});
