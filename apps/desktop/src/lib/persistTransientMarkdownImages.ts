import {markdownContainsTransientImageUrls} from '@eskerra/core';

import {dotExtensionForClipboardBytes} from './clipboard/clipboardImageFiles';
import {saveVaultImageBytes} from './desktopVaultAttachments';

function markdownImagePattern(): RegExp {
  return /!\[([^\]]*)]\(([^)]+)\)/g;
}

function decodeDataImageToBytes(url: string): {bytes: Uint8Array; mime: string} {
  const comma = url.indexOf(',');
  if (comma < 0) {
    throw new Error('Invalid data URL (missing payload)');
  }
  const header = url.slice(0, comma);
  const data = url.slice(comma + 1);
  const mimeMatch = /^data:([^;,]+)/i.exec(header);
  const mime = mimeMatch?.[1]?.trim().toLowerCase() ?? 'image/png';
  const isBase64 = /;base64/i.test(header);
  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(data));
  }
  return {bytes, mime};
}

async function persistOneTransientImageUrl(
  url: string,
  vaultRoot: string,
): Promise<string> {
  const trimmed = url.trim();
  if (/^data:image\//i.test(trimmed)) {
    const {bytes, mime} = decodeDataImageToBytes(trimmed);
    const ext = dotExtensionForClipboardBytes(bytes, mime, 'paste');
    return saveVaultImageBytes({
      vaultRoot,
      bytes,
      suggestedBaseName: 'paste',
      extensionWithDot: ext,
    });
  }
  if (/^blob:/i.test(trimmed)) {
    const res = await fetch(trimmed);
    if (!res.ok) {
      throw new Error(`Could not read pasted image (${res.status})`);
    }
    const blob = await res.blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    const ext = dotExtensionForClipboardBytes(buf, blob.type, 'paste');
    return saveVaultImageBytes({
      vaultRoot,
      bytes: buf,
      suggestedBaseName: 'paste',
      extensionWithDot: ext,
    });
  }
  throw new Error('Unsupported transient image URL in markdown.');
}

/**
 * Rewrites `blob:` / `data:image/` URLs inside `![](...)` to vault attachment paths.
 */
export async function persistTransientMarkdownImages(
  markdown: string,
  vaultRoot: string,
): Promise<string> {
  if (!markdownContainsTransientImageUrls(markdown)) {
    return markdown;
  }
  const replacements = new Map<string, string>();
  for (const m of markdown.matchAll(markdownImagePattern())) {
    const url = m[2].trim();
    if (!/^blob:/i.test(url) && !/^data:image\//i.test(url)) {
      continue;
    }
    if (!replacements.has(url)) {
      replacements.set(
        url,
        await persistOneTransientImageUrl(url, vaultRoot),
      );
    }
  }
  if (replacements.size === 0) {
    return markdown;
  }
  return markdown.replace(markdownImagePattern(), (full, alt, urlRaw) => {
    const url = String(urlRaw).trim();
    const rep = replacements.get(url);
    if (rep) {
      return `![${alt}](${rep})`;
    }
    return full;
  });
}
