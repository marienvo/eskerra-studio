import {
  imageSniffFormatToDotExtension,
  sniffImageFormatFromBytes,
} from '@eskerra/core';

/** Sync hint before `preventDefault` (MIME, extension, or ambiguous types worth sniffing). */
export function fileMightBeClipboardImageByMeta(file: File): boolean {
  const t = file.type.trim().toLowerCase();
  if (t.startsWith('image/')) {
    return true;
  }
  if (t === '' || t === 'application/octet-stream') {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

export async function isProbablyClipboardImageFile(file: File): Promise<boolean> {
  const t = file.type.trim().toLowerCase();
  if (t.startsWith('image/')) {
    return true;
  }
  if (t !== '' && t !== 'application/octet-stream') {
    return false;
  }
  const buf = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  return sniffImageFormatFromBytes(buf) !== null;
}

function dedupeFileKey(file: File): string {
  return `${file.name}\0${file.size}\0${file.lastModified}`;
}

function stripUriQueryAndHash(value: string): string {
  const hashIndex = value.indexOf('#');
  const queryIndex = value.indexOf('?');
  let cut = value.length;
  if (hashIndex >= 0 && hashIndex < cut) {
    cut = hashIndex;
  }
  if (queryIndex >= 0 && queryIndex < cut) {
    cut = queryIndex;
  }
  return value.slice(0, cut);
}

/** Synchronously copy clipboard strings and file references before any `await` (WebKit/Tauri). */
export type ClipboardImageSnapshot = {
  types: string[];
  html: string;
  /** File refs from `items` + `files` matching `fileMightBeClipboardImageByMeta`; deduped. */
  candidateFiles: File[];
};

export function snapshotClipboardImagePayload(dt: DataTransfer): ClipboardImageSnapshot {
  const types = Array.from(dt.types);
  const html = dt.getData('text/html') ?? '';
  const seen = new Set<string>();
  const candidateFiles: File[] = [];

  const add = (file: File | null) => {
    if (!file || !fileMightBeClipboardImageByMeta(file)) {
      return;
    }
    const key = dedupeFileKey(file);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidateFiles.push(file);
  };

  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') {
        add(item.getAsFile());
      }
    }
  }

  for (let i = 0; i < dt.files.length; i++) {
    add(dt.files.item(i));
  }

  return {types, html, candidateFiles};
}

/** Async validate snapshot candidates (sniff bytes when MIME is ambiguous). */
export async function filterClipboardImageCandidateFiles(
  candidateFiles: readonly File[],
): Promise<File[]> {
  const out: File[] = [];
  const seen = new Set<string>();
  for (const file of candidateFiles) {
    if (!(await isProbablyClipboardImageFile(file))) {
      continue;
    }
    const key = dedupeFileKey(file);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(file);
  }
  return out;
}

export async function collectClipboardImageFilesFromFileList(
  files: FileList,
): Promise<File[]> {
  const out: File[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const file = files.item(i);
    if (!file) {
      continue;
    }
    if (!(await isProbablyClipboardImageFile(file))) {
      continue;
    }
    const key = dedupeFileKey(file);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(file);
  }
  return out;
}

export async function collectClipboardImageFilesFromDataTransfer(
  dt: DataTransfer,
): Promise<File[]> {
  const {candidateFiles} = snapshotClipboardImagePayload(dt);
  return filterClipboardImageCandidateFiles(candidateFiles);
}

function textUriListLineLooksLikeLocalImageFile(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.toLowerCase().startsWith('file://')) {
    return false;
  }
  try {
    const noHashOrQuery = stripUriQueryAndHash(trimmed);
    const path = decodeURIComponent(noHashOrQuery.slice('file://'.length));
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
  } catch {
    return /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(trimmed);
  }
}

function fileUriToLocalPath(uri: string): string | null {
  try {
    const u = new URL(uri.trim());
    if (u.protocol !== 'file:') {
      return null;
    }
    let p = decodeURIComponent(u.pathname);
    if (/^\/[A-Za-z]:/.test(p)) {
      p = p.slice(1);
    }
    return p;
  } catch {
    return null;
  }
}

/** Absolute paths from `text/uri-list` entries that look like local image files (GNOME / file manager copy). */
export function absoluteImagePathsFromClipboardUriList(dt: DataTransfer): string[] {
  const uriList = dt.getData('text/uri-list')?.trim();
  if (!uriList) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of uriList.split(/\r?\n/)) {
    if (!textUriListLineLooksLikeLocalImageFile(raw)) {
      continue;
    }
    const baseUri = stripUriQueryAndHash(raw.trim());
    const abs = fileUriToLocalPath(baseUri);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

function clipboardMimeTypesSuggestImage(types: readonly string[]): boolean {
  return types.some(t => {
    const x = t.trim().toLowerCase();
    return (
      x === 'image/png' ||
      x === 'image/jpeg' ||
      x === 'image/jpg' ||
      x === 'image/gif' ||
      x === 'image/webp' ||
      x === 'image/bmp' ||
      x === 'image/x-png' ||
      x === 'image/x-ms-bmp' ||
      x.startsWith('image/')
    );
  });
}

function clipboardHtmlSuggestsVaultImage(html: string): boolean {
  const {blobUrls, dataImageUrls} = extractClipboardImageUrlsFromHtml(html);
  if (blobUrls.length > 0 || dataImageUrls.length > 0) {
    return true;
  }
  if (/<img\b/i.test(html)) {
    const lower = html.toLowerCase();
    return lower.includes('blob:') || lower.includes('data:image');
  }
  return false;
}

function clipboardUriListSuggestsImage(uriList: string): boolean {
  for (const raw of uriList.split(/\r?\n/)) {
    if (textUriListLineLooksLikeLocalImageFile(raw)) {
      return true;
    }
  }
  return false;
}

function clipboardFileListSuggestsImage(dt: DataTransfer): boolean {
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files.item(i);
    if (f && fileMightBeClipboardImageByMeta(f)) {
      return true;
    }
  }
  return false;
}

function clipboardDataItemsSuggestImage(dt: DataTransfer): boolean {
  if (!dt.items) {
    return false;
  }
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    const ty = item.type.trim().toLowerCase();
    if (
      ty.startsWith('image/') ||
      ty === 'image/bmp' ||
      ty === 'image/x-png' ||
      ty === 'image/x-ms-bmp'
    ) {
      return true;
    }
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f && fileMightBeClipboardImageByMeta(f)) {
        return true;
      }
    }
  }
  return false;
}

/** Synchronous: should we take over paste before the editor ingests `blob:` HTML? */
export function clipboardDataProbablyHasVaultImage(dt: DataTransfer): boolean {
  if (clipboardMimeTypesSuggestImage(Array.from(dt.types))) {
    return true;
  }
  const html = dt.getData('text/html');
  if (html && clipboardHtmlSuggestsVaultImage(html)) {
    return true;
  }
  const uriList = dt.getData('text/uri-list')?.trim();
  if (uriList && clipboardUriListSuggestsImage(uriList)) {
    return true;
  }
  if (clipboardFileListSuggestsImage(dt)) {
    return true;
  }
  return clipboardDataItemsSuggestImage(dt);
}

/** `blob:` and `data:image/` src values on `<img>` in pasted HTML. */
export function extractClipboardImageUrlsFromHtml(html: string): {
  blobUrls: string[];
  dataImageUrls: string[];
} {
  // Parse whenever clipboard HTML includes an <img>; do not require a substring
  // pre-check (case or format differ between WebKit, GTK, and Chromium).
  if (!html || !/<img\b/i.test(html)) {
    return { blobUrls: [], dataImageUrls: [] };
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const imgs = doc.querySelectorAll('img[src]');
    const blobSeen = new Set<string>();
    const dataSeen = new Set<string>();
    const blobUrls: string[] = [];
    const dataImageUrls: string[] = [];
    imgs.forEach(img => {
      const s = img.getAttribute('src')?.trim();
      if (!s) {
        return;
      }
      if (s.startsWith('blob:')) {
        if (!blobSeen.has(s)) {
          blobSeen.add(s);
          blobUrls.push(s);
        }
      } else if (/^data:image\//i.test(s)) {
        if (!dataSeen.has(s)) {
          dataSeen.add(s);
          dataImageUrls.push(s);
        }
      }
    });
    return { blobUrls, dataImageUrls };
  } catch {
    return { blobUrls: [], dataImageUrls: [] };
  }
}

export function extractBlobImageSrcsFromHtml(html: string): string[] {
  return extractClipboardImageUrlsFromHtml(html).blobUrls;
}

/** Use sniffed format when clipboard file has no useful name or MIME. */
export function dotExtensionForClipboardBytes(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): string {
  const fromMime = mimeType.trim().toLowerCase();
  if (fromMime === 'image/jpeg' || fromMime === 'image/jpg') {
    return '.jpg';
  }
  if (fromMime === 'image/png') {
    return '.png';
  }
  if (fromMime === 'image/gif') {
    return '.gif';
  }
  if (fromMime === 'image/webp') {
    return '.webp';
  }
  if (fromMime === 'image/svg+xml') {
    return '.svg';
  }

  const lower = fileName.toLowerCase();
  for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']) {
    if (lower.endsWith(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  }

  const sniffed = sniffImageFormatFromBytes(bytes.subarray(0, Math.min(bytes.length, 64)));
  return sniffed ? imageSniffFormatToDotExtension(sniffed) : '.png';
}
