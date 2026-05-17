import {describe, expect, it} from 'vitest';

import {scanPlayTriangleMarkdownLinks} from './playMarkdownLinkScan';

describe('scanPlayTriangleMarkdownLinks', () => {
  it('collects play triangle markdown links with non-empty destinations', () => {
    const line = 'x [▶](https://a.example/a.mp3) y';
    expect(scanPlayTriangleMarkdownLinks(line)).toEqual([
      {url: 'https://a.example/a.mp3', start: 2},
    ]);
  });

  it('ignores empty link destinations', () => {
    expect(scanPlayTriangleMarkdownLinks('[▶]()')).toEqual([]);
  });

  it('uses the last non-empty play link when an empty placeholder follows', () => {
    const line = 't [▶](https://good/g.mp3) [▶]()';
    expect(scanPlayTriangleMarkdownLinks(line)).toEqual([
      {url: 'https://good/g.mp3', start: 2},
    ]);
  });
});
