import type {InboxWikiLinkNoteRef} from './wikiLinkInbox';
import {
  normalizeVaultBaseUri,
  MARKDOWN_EXTENSION,
} from './vaultLayout';
import {
  tryAssertVaultMarkdownNoteUriForRelativeMarkdownLink,
} from './vaultMarkdownPaths';
import {
  isAsciiWhitespaceCode,
  isExternalMarkdownHrefTrimmed,
  readHrefScheme,
  readUriSchemeWithDoubleSlashLength,
  stripLeadingSlashes,
  stripTrailingSlashes,
  trimAndUnixSlashes,
  trimAsciiWhitespace,
  trimEndAsciiWhitespace,
} from './stringScanners';
import {vaultPathDirname} from './vaultVisibility';

function normSlashes(s: string): string {
  return trimAndUnixSlashes(s);
}

/** Strips query and fragment; trims. */
export function stripMarkdownLinkHrefToPathPart(raw: string): string {
  let s = trimAsciiWhitespace(raw);
  const q = s.indexOf('?');
  if (q >= 0) {
    s = trimEndAsciiWhitespace(s.slice(0, q));
  }
  const h = s.indexOf('#');
  if (h >= 0) {
    s = trimEndAsciiWhitespace(s.slice(0, h));
  }
  return trimAsciiWhitespace(s);
}

/** True when `href` uses a URL scheme (`http:`, `mailto:`, `//example`, …). */
export function isExternalMarkdownHref(href: string): boolean {
  const h = trimAsciiWhitespace(href);
  if (h === '' || h.startsWith('//')) {
    return true;
  }
  return isExternalMarkdownHrefTrimmed(h);
}

const BROWSER_OPENABLE_MARKDOWN_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
]);

/**
 * True when `href` may be opened in the system browser from the desktop markdown editor.
 * Allowlist: `http`, `https`, `mailto` (scheme must be present; protocol-relative URLs are excluded).
 */
export function isBrowserOpenableMarkdownHref(href: string): boolean {
  const h = trimAsciiWhitespace(href);
  if (h === '') {
    return false;
  }
  const sch = readHrefScheme(h);
  if (sch == null) {
    return false;
  }
  return BROWSER_OPENABLE_MARKDOWN_SCHEMES.has(sch.schemeLower);
}

function tryDecodeUriComponent(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Joins `rel` onto `baseDirUri` (POSIX, forward slashes). `rel` must not be external.
 * Preserves URI schemes such as `content://` (Android SAF) so the double-slash is not
 * discarded by `filter(Boolean)` on the split.
 */
export function posixResolveRelativeToDirectory(
  baseDirUri: string,
  rel: string,
): string {
  const relDecoded = tryDecodeUriComponent(trimAsciiWhitespace(rel));
  const normalized = stripTrailingSlashes(normSlashes(baseDirUri));

  const schemeLen = readUriSchemeWithDoubleSlashLength(normalized);
  const scheme = schemeLen != null ? normalized.slice(0, schemeLen) : '';
  const pathAfterScheme = schemeLen != null ? normalized.slice(schemeLen) : normalized;

  const baseParts = pathAfterScheme.split('/').filter(Boolean);
  const relParts = relDecoded.split('/').filter(p => p !== '' && p !== '.');
  const stack = [...baseParts];
  for (const p of relParts) {
    if (p === '..') {
      stack.pop();
    } else {
      stack.push(p);
    }
  }
  const resolvedPath = `/${stack.join('/')}`;
  return scheme ? `${scheme}${resolvedPath.slice(1)}` : resolvedPath;
}

/**
 * Relative path from `fromDirUri` (directory) to `toFileUri` (file), forward slashes.
 * Same-directory targets use `./file.md`.
 */
export function posixRelativeVaultPath(fromDirUri: string, toFileUri: string): string {
  const fromParts = stripTrailingSlashes(normSlashes(fromDirUri)).split('/').filter(Boolean);
  const toParts = normSlashes(toFileUri).split('/').filter(Boolean);
  let i = 0;
  const max = Math.min(fromParts.length, toParts.length);
  while (
    i < max
    && fromParts[i]!.toLowerCase() === toParts[i]!.toLowerCase()
  ) {
    i++;
  }
  const up = fromParts.length - i;
  const down = toParts.slice(i);
  if (up === 0 && down.length === 1) {
    return `./${down[0]!}`;
  }
  const upSeg = up === 0 ? '' : `${[...Array(up)].map(() => '..').join('/')}/`;
  return `${upSeg}${down.join('/')}`;
}

function canonicalVaultNoteUriFromRefs(
  resolvedUri: string,
  noteRefs: ReadonlyArray<InboxWikiLinkNoteRef>,
): string | undefined {
  const folded = tryDecodeUriComponent(normSlashes(resolvedUri)).toLowerCase();
  let match: string | undefined;
  for (const ref of noteRefs) {
    const refDecoded = tryDecodeUriComponent(normSlashes(ref.uri)).toLowerCase();
    if (refDecoded === folded) {
      if (match !== undefined && match !== ref.uri) {
        return undefined;
      }
      match = normSlashes(ref.uri);
    }
  }
  return match;
}

export type ResolveVaultRelativeMarkdownHrefResult = {
  uri: string;
  /** Present when casing or path should be normalized in source. */
  canonicalHref?: string;
};

function sourceDirectoryForRelativeLink(
  sourceMarkdownUriOrDir: string,
): string {
  const n = normSlashes(sourceMarkdownUriOrDir);
  if (n.toLowerCase().endsWith(MARKDOWN_EXTENSION.toLowerCase())) {
    return vaultPathDirname(n);
  }
  return stripTrailingSlashes(n);
}

type SafDocumentUriParts = {
  prefix: string;
  documentId: string;
};

type SafDocumentResolvedHref = {
  uri: string;
  validationUri: string;
};

function splitSafDocumentUri(uri: string): SafDocumentUriParts | null {
  if (!uri.startsWith('content://')) {
    return null;
  }
  const marker = '/document/';
  const markerIndex = uri.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const prefix = uri.slice(0, markerIndex + marker.length);
  const documentId = uri.slice(markerIndex + marker.length);
  if (documentId === '' || documentId.includes('/')) {
    return null;
  }
  return {prefix, documentId};
}

function safTreeDocumentIdFromRootUri(vaultRoot: string): string | null {
  const root = stripTrailingSlashes(normSlashes(vaultRoot));
  if (!root.startsWith('content://')) {
    return null;
  }
  const marker = '/tree/';
  const markerIndex = root.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const treeId = root.slice(markerIndex + marker.length).split('/')[0] ?? '';
  return treeId === '' ? null : tryDecodeUriComponent(treeId);
}

function encodeSafDocumentId(documentId: string): string {
  return encodeURIComponent(documentId);
}

function resolveSafDocumentRelativeMarkdownHref(
  vaultRoot: string,
  sourceMarkdownUriOrDir: string,
  pathPart: string,
): SafDocumentResolvedHref | null | undefined {
  const parts = splitSafDocumentUri(normSlashes(sourceMarkdownUriOrDir));
  if (!parts) {
    return undefined;
  }
  const rootDocumentId = safTreeDocumentIdFromRootUri(vaultRoot);
  if (!rootDocumentId) {
    return null;
  }

  const sourceDocumentId = tryDecodeUriComponent(parts.documentId);
  if (
    sourceDocumentId !== rootDocumentId
    && !sourceDocumentId.startsWith(`${rootDocumentId}/`)
  ) {
    return null;
  }
  const sourceIsMarkdownFile = sourceDocumentId
    .toLowerCase()
    .endsWith(MARKDOWN_EXTENSION.toLowerCase());
  const sourceDirDocumentId = sourceIsMarkdownFile
    ? vaultPathDirname(sourceDocumentId)
    : stripTrailingSlashes(sourceDocumentId);
  const targetDocumentId = pathPart.startsWith('/')
    ? stripLeadingSlashes(
      posixResolveRelativeToDirectory(
        rootDocumentId,
        normSlashes(stripLeadingSlashes(tryDecodeUriComponent(pathPart))),
      ),
    )
    : stripLeadingSlashes(posixResolveRelativeToDirectory(sourceDirDocumentId, pathPart));
  if (
    targetDocumentId !== rootDocumentId
    && !targetDocumentId.startsWith(`${rootDocumentId}/`)
  ) {
    return null;
  }

  const decodedRoot = tryDecodeUriComponent(stripTrailingSlashes(normSlashes(vaultRoot)));
  const targetRelativeToRoot = targetDocumentId === rootDocumentId
    ? ''
    : targetDocumentId.slice(rootDocumentId.length + 1);
  return {
    uri: `${parts.prefix}${encodeSafDocumentId(targetDocumentId)}`,
    validationUri: targetRelativeToRoot
      ? `${decodedRoot}/${targetRelativeToRoot}`
      : decodedRoot,
  };
}

/**
 * Resolves a relative inline-markdown `href` to a vault `.md` URI, or `null`.
 * `sourceMarkdownUriOrDir` is either the open note URI (ends with `.md`) or an absolute vault
 * directory URI (for example the Inbox folder while composing a note).
 * Optional `noteRefs` folds casing to a canonical indexed URI when exactly one note matches.
 */
export function resolveVaultRelativeMarkdownHref(
  vaultRoot: string,
  sourceMarkdownUriOrDir: string,
  rawHref: string,
  noteRefs?: ReadonlyArray<InboxWikiLinkNoteRef>,
): ResolveVaultRelativeMarkdownHrefResult | null {
  const pathPart = stripMarkdownLinkHrefToPathPart(rawHref);
  if (pathPart === '' || isExternalMarkdownHref(pathPart)) {
    return null;
  }
  if (!pathPart.toLowerCase().endsWith(MARKDOWN_EXTENSION.toLowerCase())) {
    return null;
  }
  const baseRaw = stripTrailingSlashes(normSlashes(normalizeVaultBaseUri(vaultRoot)));
  const base = tryDecodeUriComponent(baseRaw);
  const sourceRaw = normSlashes(sourceMarkdownUriOrDir);
  const sourceDecoded = tryDecodeUriComponent(sourceRaw);
  const dir = sourceDirectoryForRelativeLink(sourceDecoded);
  const decodedPart = tryDecodeUriComponent(pathPart);
  const safJoined = resolveSafDocumentRelativeMarkdownHref(baseRaw, sourceRaw, pathPart);
  if (safJoined === null) {
    return null;
  }
  const joined = safJoined?.uri ?? (decodedPart.startsWith('/')
    ? normSlashes(decodedPart)
    : posixResolveRelativeToDirectory(dir, pathPart));
  let validated: string | null;
  if (safJoined) {
    validated = tryAssertVaultMarkdownNoteUriForRelativeMarkdownLink(
      base,
      safJoined.validationUri,
    ) ? joined : null;
  } else {
    validated =
      tryAssertVaultMarkdownNoteUriForRelativeMarkdownLink(baseRaw, joined)
      ?? tryAssertVaultMarkdownNoteUriForRelativeMarkdownLink(
        base,
        tryDecodeUriComponent(joined),
      );
  }
  if (!validated) {
    return null;
  }
  let uri = validated;
  let canonicalHref: string | undefined;
  if (noteRefs && noteRefs.length > 0) {
    const canon = canonicalVaultNoteUriFromRefs(validated, noteRefs);
    if (canon) {
      uri = canon;
      const nextHref = posixRelativeVaultPath(dir, canon);
      const stripped = stripMarkdownLinkHrefToPathPart(rawHref);
      const compareRaw = normSlashes(stripped);
      const compareDecoded = normSlashes(tryDecodeUriComponent(stripped));
      if (nextHref !== compareRaw && nextHref !== compareDecoded) {
        canonicalHref = nextHref;
      }
    }
  }
  return {uri, ...(canonicalHref ? {canonicalHref} : {})};
}

export type InlineMarkdownLinkMatch = {
  fullMatchStart: number;
  fullMatchEnd: number;
  hrefStart: number;
  hrefEnd: number;
  isImage: boolean;
};

function findWikiLinkEnd(s: string, openBracketIdx: number): number {
  if (s.slice(openBracketIdx, openBracketIdx + 2) !== '[[') {
    return openBracketIdx;
  }
  let j = openBracketIdx + 2;
  while (j < s.length - 1) {
    if (s[j] === ']' && s[j + 1] === ']') {
      return j + 2;
    }
    j++;
  }
  return s.length;
}

function scanInlineLink(
  s: string,
  labelOpenIdx: number,
  isImage: boolean,
): InlineMarkdownLinkMatch | null {
  let j = labelOpenIdx + (isImage ? 2 : 1);
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) {
      j += 2;
      continue;
    }
    if (c === ']') {
      break;
    }
    j++;
  }
  if (j >= s.length || s[j] !== ']') {
    return null;
  }
  const afterLabel = j + 1;
  let k = afterLabel;
  while (k < s.length && isAsciiWhitespaceCode(s.charCodeAt(k))) {
    k++;
  }
  if (k >= s.length || s[k] !== '(') {
    return null;
  }
  let u = k + 1;
  while (u < s.length) {
    const c = s[u];
    if (c === '\\' && u + 1 < s.length) {
      u += 2;
      continue;
    }
    if (c === ')') {
      const hrefStart = k + 1;
      const hrefEnd = u;
      return {
        fullMatchStart: isImage ? labelOpenIdx : labelOpenIdx,
        fullMatchEnd: u + 1,
        hrefStart,
        hrefEnd,
        isImage,
      };
    }
    u++;
  }
  return null;
}

/**
 * Extracts inline `[text](href)` spans (and images) with byte offsets in `markdown` (UTF-16 indices
 * match JS string positions).
 */
export function extractInlineMarkdownLinksFromMarkdown(
  markdown: string,
): InlineMarkdownLinkMatch[] {
  const out: InlineMarkdownLinkMatch[] = [];
  let i = 0;
  while (i < markdown.length) {
    if (markdown[i] === '[' && markdown[i + 1] === '[') {
      i = findWikiLinkEnd(markdown, i);
      continue;
    }
    if (markdown[i] === '!' && markdown[i + 1] === '[') {
      const m = scanInlineLink(markdown, i, true);
      if (m) {
        out.push(m);
        i = m.fullMatchEnd;
        continue;
      }
    }
    if (markdown[i] === '[') {
      const m = scanInlineLink(markdown, i, false);
      if (m) {
        out.push(m);
        i = m.fullMatchEnd;
        continue;
      }
    }
    i++;
  }
  return out;
}

export type InboxRelativeMarkdownLinkRenameMarkdownPlan = {
  changed: boolean;
  markdown: string;
  updatedLinkCount: number;
};

export function planInboxRelativeMarkdownLinkRenameInMarkdown(options: {
  markdown: string;
  sourceUri: string;
  oldTargetUri: string;
  newTargetUri: string;
  vaultRoot: string;
  noteRefs: ReadonlyArray<InboxWikiLinkNoteRef>;
}): InboxRelativeMarkdownLinkRenameMarkdownPlan {
  const {
    markdown,
    sourceUri,
    oldTargetUri,
    newTargetUri,
    vaultRoot,
    noteRefs,
  } = options;
  const matches = extractInlineMarkdownLinksFromMarkdown(markdown);
  const oldNorm = normSlashes(oldTargetUri);
  const newNorm = normSlashes(newTargetUri);
  const sourceNorm = normSlashes(sourceUri);
  const dir = vaultPathDirname(sourceNorm);

  const edits: Array<{start: number; end: number; text: string}> = [];
  let updatedLinkCount = 0;

  for (const m of matches) {
    if (m.isImage) {
      continue;
    }
    const hrefRaw = markdown.slice(m.hrefStart, m.hrefEnd);
    const resolved = resolveVaultRelativeMarkdownHref(
      vaultRoot,
      sourceUri,
      hrefRaw,
      noteRefs,
    );
    if (
      !resolved
      || normSlashes(resolved.uri).toLowerCase() !== oldNorm.toLowerCase()
    ) {
      continue;
    }
    const nextHref = posixRelativeVaultPath(dir, newNorm);
    edits.push({
      start: m.hrefStart,
      end: m.hrefEnd,
      text: nextHref,
    });
    updatedLinkCount++;
  }

  if (updatedLinkCount === 0) {
    return {changed: false, markdown, updatedLinkCount: 0};
  }

  edits.sort((a, b) => b.start - a.start);
  let out = markdown;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return {changed: true, markdown: out, updatedLinkCount};
}

/**
 * Lists vault markdown notes whose bodies link to `targetUri` via a relative `.md` inline link.
 */
export function listInboxRelativeMarkdownLinkBacklinkReferrersForTarget(options: {
  targetUri: string;
  notes: ReadonlyArray<InboxWikiLinkNoteRef>;
  contentByUri: Readonly<Record<string, string>>;
  activeUri: string | null;
  activeBody: string;
  vaultRoot: string;
}): readonly string[] {
  const {targetUri, notes, contentByUri, activeUri, activeBody, vaultRoot} = options;
  const referrers = new Set<string>();
  const targetNorm = normSlashes(targetUri);

  for (const source of notes) {
    const sourceBody =
      activeUri != null && source.uri === activeUri
        ? activeBody
        : (contentByUri[source.uri] ?? '');
    const links = extractInlineMarkdownLinksFromMarkdown(sourceBody);
    for (const m of links) {
      if (m.isImage) {
        continue;
      }
      const hrefRaw = sourceBody.slice(m.hrefStart, m.hrefEnd);
      const resolved = resolveVaultRelativeMarkdownHref(
        vaultRoot,
        source.uri,
        hrefRaw,
        notes,
      );
      if (!resolved) {
        continue;
      }
      if (resolved.uri === source.uri) {
        continue;
      }
      if (
        normSlashes(resolved.uri).toLowerCase() === targetNorm.toLowerCase()
      ) {
        referrers.add(source.uri);
      }
    }
  }

  return [...referrers].sort((a, b) => a.localeCompare(b));
}
