import {describe, expect, it} from 'vitest';

import {
  absoluteImagePathsFromClipboardUriList,
  clipboardDataProbablyHasVaultImage,
  extractBlobImageSrcsFromHtml,
  extractClipboardImageUrlsFromHtml,
  filterClipboardImageCandidateFiles,
  snapshotClipboardImagePayload,
} from './clipboardImageFiles';

/** Minimal bytes that pass `sniffImageFormatFromBytes` as PNG. */
function minimalPngPayload(): BlobPart {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

describe('extractClipboardImageUrlsFromHtml', () => {
  it('collects blob and data:image sources in document order', () => {
    const html =
      '<div><img src="data:image/png;base64,iVBORw0KGgo="></div><img src="blob:http://localhost/x">';
    const {blobUrls, dataImageUrls} = extractClipboardImageUrlsFromHtml(html);
    expect(dataImageUrls.length).toBe(1);
    expect(dataImageUrls[0].startsWith('data:image/png')).toBe(true);
    expect(blobUrls).toEqual(['blob:http://localhost/x']);
  });

  it('dedupes repeated src values', () => {
    const html =
      '<img src="data:image/gif;base64,R0lGODlh"><img src="data:image/gif;base64,R0lGODlh">';
    const {dataImageUrls} = extractClipboardImageUrlsFromHtml(html);
    expect(dataImageUrls.length).toBe(1);
  });

  it('ignores non-image data URLs and http images', () => {
    const html =
      '<img src="data:text/plain;base64,AA"><img src="https://x/y.png">';
    const {blobUrls, dataImageUrls} = extractClipboardImageUrlsFromHtml(html);
    expect(blobUrls).toEqual([]);
    expect(dataImageUrls).toEqual([]);
  });

  it('returns empty when no img with transient src', () => {
    expect(extractClipboardImageUrlsFromHtml('<p>hi</p>')).toEqual({
      blobUrls: [],
      dataImageUrls: [],
    });
  });

  it('parses uppercase IMG tags with blob src', () => {
    const html = '<IMG SRC="blob:http://localhost/x">';
    expect(extractClipboardImageUrlsFromHtml(html).blobUrls).toEqual([
      'blob:http://localhost/x',
    ]);
  });

  it('parses img without relying on raw substring pre-check (https-only src)', () => {
    const html = '<img src="https://example.com/y.png">';
    expect(extractClipboardImageUrlsFromHtml(html)).toEqual({
      blobUrls: [],
      dataImageUrls: [],
    });
  });
});

describe('extractBlobImageSrcsFromHtml', () => {
  it('delegates to shared extraction', () => {
    const html = '<img src="blob:http://x/y">';
    expect(extractBlobImageSrcsFromHtml(html)).toEqual(['blob:http://x/y']);
  });
});

describe('clipboardDataProbablyHasVaultImage', () => {
  it('is true when HTML embeds data:image without clipboard files', () => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<img src="data:image/png;base64,AAAA">');
    expect(clipboardDataProbablyHasVaultImage(dt)).toBe(true);
  });

  it('is true for img+transient hint when DOMParser yields no src (fallback)', () => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<img broken attr blob:http://localhost/x data:image/png;base64,QQ>',
    );
    expect(clipboardDataProbablyHasVaultImage(dt)).toBe(true);
  });

  it('is true for file item with empty MIME when name looks like an image', () => {
    const file = new File([minimalPngPayload()], 'paste.png', {type: ''});
    const dt = {
      types: [],
      getData: () => '',
      files: {length: 0, item: () => null},
      items: [{kind: 'file', type: '', getAsFile: () => file}],
    } as unknown as DataTransfer;
    expect(clipboardDataProbablyHasVaultImage(dt)).toBe(true);
  });

  it('is true when types include image/x-png', () => {
    const dt = {
      types: ['image/x-png'],
      getData: () => '',
      files: {length: 0, item: () => null},
      items: [],
    } as unknown as DataTransfer;
    expect(clipboardDataProbablyHasVaultImage(dt)).toBe(true);
  });

  it('is true for text/uri-list with a local image file URL (GNOME)', () => {
    const dt = new DataTransfer();
    dt.setData(
      'text/uri-list',
      'file:///home/user/Pictures/shot.png',
    );
    expect(clipboardDataProbablyHasVaultImage(dt)).toBe(true);
  });

  it('is false for text/uri-list with a non-image file', () => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', 'file:///tmp/readme.txt');
    expect(clipboardDataProbablyHasVaultImage(dt)).toBe(false);
  });
});

describe('absoluteImagePathsFromClipboardUriList', () => {
  it('extracts absolute paths for image lines', () => {
    const dt = new DataTransfer();
    dt.setData(
      'text/uri-list',
      'file:///home/a/one.png\r\nfile:///home/b/two.JPEG',
    );
    expect(absoluteImagePathsFromClipboardUriList(dt)).toEqual([
      '/home/a/one.png',
      '/home/b/two.JPEG',
    ]);
  });

  it('dedupes and skips non-images', () => {
    const dt = new DataTransfer();
    dt.setData(
      'text/uri-list',
      'file:///x/same.png\nfile:///x/same.png\nfile:///x/doc.txt',
    );
    expect(absoluteImagePathsFromClipboardUriList(dt)).toEqual(['/x/same.png']);
  });
});

describe('snapshotClipboardImagePayload', () => {
  it('captures html and types from a real DataTransfer', () => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<p>x</p>');
    const s = snapshotClipboardImagePayload(dt);
    expect(s.html).toBe('<p>x</p>');
    expect(Array.isArray(s.types)).toBe(true);
    expect(s.candidateFiles).toEqual([]);
  });

  it('synchronously retains file refs from mocked file items (empty MIME)', () => {
    const file = new File([minimalPngPayload()], 'paste.png', {type: ''});
    const dt = {
      types: ['Files'],
      getData: () => '',
      files: {length: 0, item: () => null},
      items: [{kind: 'file', type: '', getAsFile: () => file}],
    } as unknown as DataTransfer;
    const s = snapshotClipboardImagePayload(dt);
    expect(s.candidateFiles).toEqual([file]);
  });
});

describe('filterClipboardImageCandidateFiles', () => {
  it('accepts PNG magic when file type is empty', async () => {
    const file = new File([minimalPngPayload()], 'x', {type: ''});
    const out = await filterClipboardImageCandidateFiles([file]);
    expect(out).toEqual([file]);
  });
});
