import {describe, expect, it} from 'vitest';

import {rgbaOrRgbToImageDataPixels} from './clipboardImagePng';

describe('rgbaOrRgbToImageDataPixels', () => {
  it('expands RGB to RGBA with full opacity', () => {
    const raw = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const out = rgbaOrRgbToImageDataPixels(raw, 2, 1);
    expect(Array.from(out)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('passes through RGBA when length matches', () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    const out = rgbaOrRgbToImageDataPixels(raw, 1, 1);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it('truncates oversized buffer to width*height*4', () => {
    const raw = new Uint8Array(20);
    raw.fill(7);
    const out = rgbaOrRgbToImageDataPixels(raw, 1, 1);
    expect(out.length).toBe(4);
    expect(Array.from(out)).toEqual([7, 7, 7, 7]);
  });

  it('throws on undersized buffer', () => {
    expect(() => rgbaOrRgbToImageDataPixels(new Uint8Array([1, 2]), 2, 2)).toThrow(
      /size mismatch/,
    );
  });
});
