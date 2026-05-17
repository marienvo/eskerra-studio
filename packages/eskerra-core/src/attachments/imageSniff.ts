import {trimAsciiWhitespace} from '../stringScanners';

/**
 * Magic-byte sniff for common image formats. Mirrors desktop vault validation
 * so clipboard files with missing MIME types still classify as images.
 */

export type ImageSniffFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'svg';

export function imageSniffFormatToDotExtension(format: ImageSniffFormat): string {
  switch (format) {
    case 'jpg':
      return '.jpg';
    case 'png':
      return '.png';
    case 'gif':
      return '.gif';
    case 'webp':
      return '.webp';
    case 'svg':
      return '.svg';
  }
}

export function sniffImageFormatFromBytes(buf: Uint8Array): ImageSniffFormat | null {
  const trimmed = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;

  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  if (
    (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 && buf[4] === 0x37 && buf[5] === 0x61) ||
    (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 && buf[4] === 0x39 && buf[5] === 0x61)
  ) {
    return 'gif';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp';
  }

  const prefix = new TextDecoder('utf-8', {fatal: false}).decode(trimmed.subarray(0, Math.min(trimmed.length, 256)));
  const p = prefix.trimStart();
  if (p.startsWith('<svg') || p.startsWith('<?xml') || p.includes('<svg')) {
    return 'svg';
  }

  return null;
}

function isTransientPasteImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith('blob:') || lower.startsWith('data:image/');
}

/** Markdown image syntax that points at ephemeral or non-vault URIs (paste artifacts). */
export function markdownContainsTransientImageUrls(markdown: string): boolean {
  let i = 0;
  while (i + 1 < markdown.length) {
    if (markdown.charCodeAt(i) !== 33 || markdown.charCodeAt(i + 1) !== 91) {
      i++;
      continue;
    }
    i += 2;
    while (i < markdown.length && markdown.charCodeAt(i) !== 93) {
      i++;
    }
    if (i >= markdown.length || markdown.charCodeAt(i) !== 93) {
      continue;
    }
    if (i + 1 >= markdown.length || markdown.charCodeAt(i + 1) !== 40) {
      i++;
      continue;
    }
    i += 2;
    const urlStart = i;
    while (i < markdown.length && markdown.charCodeAt(i) !== 41) {
      i++;
    }
    if (i >= markdown.length) {
      break;
    }
    const url = trimAsciiWhitespace(markdown.slice(urlStart, i));
    if (isTransientPasteImageUrl(url)) {
      return true;
    }
    i++;
  }
  return false;
}
