import {describe, expect, it} from 'vitest';

import {
  imageSniffFormatToDotExtension,
  markdownContainsTransientImageUrls,
  sniffImageFormatFromBytes,
} from './imageSniff';

describe('sniffImageFormatFromBytes', () => {
  it('detects PNG', () => {
    const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffImageFormatFromBytes(sig)).toBe('png');
  });

  it('detects JPEG', () => {
    expect(sniffImageFormatFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
  });

  it('detects GIF89a', () => {
    const s = new TextEncoder().encode('GIF89a');
    expect(sniffImageFormatFromBytes(s)).toBe('gif');
  });

  it('detects WebP', () => {
    const buf = new Uint8Array(12);
    buf.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);
    buf.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageFormatFromBytes(buf)).toBe('webp');
  });

  it('detects SVG snippet', () => {
    const s = new TextEncoder().encode('  <svg xmlns="http://www.w3.org/2000/svg">');
    expect(sniffImageFormatFromBytes(s)).toBe('svg');
  });

  it('returns null for random bytes', () => {
    expect(sniffImageFormatFromBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe('imageSniffFormatToDotExtension', () => {
  it('maps formats', () => {
    expect(imageSniffFormatToDotExtension('png')).toBe('.png');
    expect(imageSniffFormatToDotExtension('jpg')).toBe('.jpg');
    expect(imageSniffFormatToDotExtension('svg')).toBe('.svg');
  });
});

describe('markdownContainsTransientImageUrls', () => {
  it('detects blob markdown images', () => {
    expect(
      markdownContainsTransientImageUrls('![](blob:http://localhost:5173/abc)'),
    ).toBe(true);
  });

  it('detects data URLs', () => {
    expect(
      markdownContainsTransientImageUrls('x ![a](data:image/png;base64,AAAA) y'),
    ).toBe(true);
  });

  it('ignores normal relative paths', () => {
    expect(
      markdownContainsTransientImageUrls('![](../Assets/Attachments/foo.png)'),
    ).toBe(false);
  });

  it('ignores https images', () => {
    expect(markdownContainsTransientImageUrls('![](https://x/y.png)')).toBe(false);
  });

  it('handles long markdown without false positives', () => {
    const pad = '![](https://x/y.png)'.repeat(2000);
    expect(markdownContainsTransientImageUrls(pad)).toBe(false);
  });
});
