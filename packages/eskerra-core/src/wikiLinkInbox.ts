import {sanitizeInboxNoteStem, stemFromMarkdownFileName} from './inboxMarkdown';
import {
  getInboxDirectoryUri,
  MARKDOWN_EXTENSION,
  normalizeVaultBaseUri,
} from './vaultLayout';
import {stripTrailingSlashes, trimAndUnixSlashes} from './stringScanners';
import {
  isBrowserOpenableMarkdownHref,
  stripMarkdownLinkHrefToPathPart,
} from './vaultRelativeMarkdownLink';

export type InboxWikiLinkNoteRef = {
  name: string;
  uri: string;
};

export type ParsedWikiLinkInner = {
  displayText: string | null;
  targetText: string;
};

export type InboxWikiLinkResolveResult =
  | {kind: 'open'; note: InboxWikiLinkNoteRef; canonicalInner?: string}
  | {kind: 'create'; title: string}
  | {
      kind: 'ambiguous';
      notes: InboxWikiLinkNoteRef[];
      targetStem: string;
      title: string;
    }
  | {kind: 'unsupported'; reason: 'empty_target' | 'path_not_supported'};

function splitWikiLinkInner(inner: string): ParsedWikiLinkInner {
  const raw = inner.trim();
  const pipeAt = raw.indexOf('|');
  if (pipeAt < 0) {
    return {displayText: null, targetText: raw};
  }
  const targetText = raw.slice(0, pipeAt).trim();
  const displayRaw = raw.slice(pipeAt + 1).trim();
  return {
    displayText: displayRaw === '' ? null : displayRaw,
    targetText,
  };
}

/**
 * If the wiki link target (text before `|`) is an `http` / `https` / `mailto` href that
 * may be opened from the desktop editor, returns the trimmed href; otherwise null.
 */
export function wikiLinkInnerBrowserOpenableHref(inner: string): string | null {
  const parsed = splitWikiLinkInner(inner);
  const href = parsed.targetText.trim();
  return isBrowserOpenableMarkdownHref(href) ? href : null;
}

/**
 * When a wiki link points at a vault `.md` via a relative path (contains '/' or '\\' before the
 * extension), returns the `href` string to pass to {@link resolveVaultRelativeMarkdownHref}.
 * Uses the same optional `Inbox/` prefix stripping as {@link resolveInboxWikiLinkTarget}.
 */
export function wikiLinkInnerVaultRelativeMarkdownHref(inner: string): string | null {
  const parsed = splitWikiLinkInner(inner);
  const pathless = stripInboxPrefixCaseInsensitive(parsed.targetText.trim());
  if (pathless === '') {
    return null;
  }
  if (!pathless.includes('/') && !pathless.includes('\\')) {
    return null;
  }
  const pathPart = stripMarkdownLinkHrefToPathPart(pathless);
  if (pathPart === '') {
    return null;
  }
  if (pathPart.toLowerCase().endsWith(MARKDOWN_EXTENSION.toLowerCase())) {
    return pathless;
  }
  return appendMarkdownExtensionBeforeHrefSuffix(pathless);
}

function appendMarkdownExtensionBeforeHrefSuffix(href: string): string {
  const queryAt = href.indexOf('?');
  const fragmentAt = href.indexOf('#');
  const suffixAt = [queryAt, fragmentAt]
    .filter(i => i >= 0)
    .reduce<number | null>((min, i) => (min == null || i < min ? i : min), null);
  if (suffixAt == null) {
    return `${href}${MARKDOWN_EXTENSION}`;
  }
  return `${href.slice(0, suffixAt)}${MARKDOWN_EXTENSION}${href.slice(suffixAt)}`;
}

/**
 * Directory URI passed as `sourceMarkdownUriOrDir` to {@link resolveVaultRelativeMarkdownHref} for
 * path-shaped wiki links `[[.../note.md]]`.
 *
 * - Paths without leading `./` or `../` are resolved from the **vault root** so backup-style paths
 *   like `_autosync-backup-nuc/General/x.md` are not nested under the open note’s folder (e.g. Today hub `General`).
 * - Optional `Inbox/` prefix on the wiki target uses the **Inbox** directory (the stripped href is relative to Inbox).
 * - Leading `./` or `../` uses `fallbackSourceMarkdownUriOrDir` (open note URI or directory), matching normal relative links.
 */
export function wikiLinkInnerPathResolutionSourceDirectoryUri(
  vaultRoot: string,
  inner: string,
  fallbackSourceMarkdownUriOrDir: string,
): string {
  const href = wikiLinkInnerVaultRelativeMarkdownHref(inner);
  if (href == null) {
    return fallbackSourceMarkdownUriOrDir;
  }
  const pathPart = stripMarkdownLinkHrefToPathPart(href);
  if (pathPart.startsWith('./') || pathPart.startsWith('../')) {
    return fallbackSourceMarkdownUriOrDir;
  }
  const parsed = splitWikiLinkInner(inner);
  const trimmedTarget = parsed.targetText.trim();
  if (hasInboxPrefixCaseInsensitive(trimmedTarget)) {
    const base = stripTrailingSlashes(trimAndUnixSlashes(normalizeVaultBaseUri(vaultRoot)));
    return getInboxDirectoryUri(base);
  }
  return stripTrailingSlashes(trimAndUnixSlashes(normalizeVaultBaseUri(vaultRoot)));
}

function stripInboxPrefixCaseInsensitive(target: string): string {
  if (target.length < 6) {
    return target;
  }
  if (target.slice(0, 6).toLowerCase() === 'inbox/') {
    return target.slice(6).trim();
  }
  return target;
}

function hasInboxPrefixCaseInsensitive(target: string): boolean {
  return target.length >= 6 && target.slice(0, 6).toLowerCase() === 'inbox/';
}

function normalizeTargetToStem(targetText: string): {
  kind: 'ok';
  pathlessTarget: string;
  stem: string;
  hadInboxPrefix: boolean;
} | {
  kind: 'unsupported';
  reason: 'empty_target' | 'path_not_supported';
} {
  const trimmedTarget = targetText.trim();
  const hadInboxPrefix = hasInboxPrefixCaseInsensitive(trimmedTarget);
  const pathlessTarget = stripInboxPrefixCaseInsensitive(trimmedTarget);
  if (pathlessTarget === '') {
    return {kind: 'unsupported', reason: 'empty_target'};
  }
  if (pathlessTarget.includes('/') || pathlessTarget.includes('\\')) {
    return {kind: 'unsupported', reason: 'path_not_supported'};
  }
  return {
    kind: 'ok',
    pathlessTarget,
    stem: pathlessTarget,
    hadInboxPrefix,
  };
}

function buildCanonicalInnerForOpen(options: {
  parsed: ParsedWikiLinkInner;
  canonicalStem: string;
  hadInboxPrefix: boolean;
}): string {
  const {parsed, canonicalStem, hadInboxPrefix} = options;
  const targetText = hadInboxPrefix ? `Inbox/${canonicalStem}` : canonicalStem;
  if (parsed.displayText == null) {
    return targetText;
  }
  return `${targetText}|${parsed.displayText}`;
}

/**
 * Given the original wiki link `inner` and the stem of the file that was just created (i.e. the
 * sanitized disk stem without `.md`), returns the canonical inner to write back into the editor.
 * Preserves display text after `|` and optional Inbox prefix.
 * Returns `null` when the inner already matches the canonical form (no rewrite needed).
 */
export function buildWikiLinkInnerForCreatedStem(
  inner: string,
  createdStem: string,
): string | null {
  const parsed = splitWikiLinkInner(inner);
  const hadInboxPrefix = hasInboxPrefixCaseInsensitive(parsed.targetText.trim());
  const canonical = buildCanonicalInnerForOpen({parsed, canonicalStem: createdStem, hadInboxPrefix});
  return canonical === inner.trim() ? null : canonical;
}

function buildSanitizedStemKey(rawStem: string): string | null {
  const sanitized = sanitizeInboxNoteStem(rawStem);
  if (!sanitized) {
    return null;
  }
  return sanitized.toLowerCase();
}

function pushNoteRefBucket(
  map: Map<string, InboxWikiLinkNoteRef[]>,
  key: string,
  note: InboxWikiLinkNoteRef,
) {
  const existing = map.get(key);
  if (existing) {
    existing.push(note);
  } else {
    map.set(key, [note]);
  }
}

/**
 * Precomputed stem buckets for inbox wiki-link resolution.
 * Built once per backlinks scan; per-link lookup is then O(1) map access.
 */
export type InboxWikiLinkResolveLookup = {
  byExactStem: ReadonlyMap<string, readonly InboxWikiLinkNoteRef[]>;
  byFoldedStem: ReadonlyMap<string, readonly InboxWikiLinkNoteRef[]>;
  bySanitizedKey: ReadonlyMap<string, readonly InboxWikiLinkNoteRef[]>;
};

export function buildInboxWikiLinkResolveLookup(
  notes: ReadonlyArray<InboxWikiLinkNoteRef>,
): InboxWikiLinkResolveLookup {
  const byExactStem = new Map<string, InboxWikiLinkNoteRef[]>();
  const byFoldedStem = new Map<string, InboxWikiLinkNoteRef[]>();
  const bySanitizedKey = new Map<string, InboxWikiLinkNoteRef[]>();

  for (const n of notes) {
    const stem = stemFromMarkdownFileName(n.name);
    pushNoteRefBucket(byExactStem, stem, n);
    pushNoteRefBucket(byFoldedStem, stem.toLowerCase(), n);
    const sk = buildSanitizedStemKey(stem);
    if (sk) {
      pushNoteRefBucket(bySanitizedKey, sk, n);
    }
  }

  return {byExactStem, byFoldedStem, bySanitizedKey};
}

/**
 * Same semantics as {@link resolveInboxWikiLinkTarget}, using a precomputed lookup.
 * Intended for batch workloads (e.g. backlinks extraction); single-call sites keep using
 * `resolveInboxWikiLinkTarget` to avoid map setup cost.
 */
export function resolveInboxWikiLinkTargetWithLookup(
  lookup: InboxWikiLinkResolveLookup,
  inner: string,
): InboxWikiLinkResolveResult {
  const parsed = splitWikiLinkInner(inner);
  const normalized = normalizeTargetToStem(parsed.targetText);
  if (normalized.kind === 'unsupported') {
    return {kind: 'unsupported', reason: normalized.reason};
  }

  const {pathlessTarget, stem, hadInboxPrefix} = normalized;
  const exactMatches = [...(lookup.byExactStem.get(stem) ?? [])];
  if (exactMatches.length === 1) {
    return {kind: 'open', note: exactMatches[0]};
  }

  const title = parsed.displayText ?? pathlessTarget;
  if (exactMatches.length > 1) {
    return {
      kind: 'ambiguous',
      notes: exactMatches,
      targetStem: stem,
      title,
    };
  }

  const foldedStem = stem.toLowerCase();
  const foldedMatches = [...(lookup.byFoldedStem.get(foldedStem) ?? [])];
  if (foldedMatches.length === 1) {
    const canonicalStem = stemFromMarkdownFileName(foldedMatches[0].name);
    return {
      kind: 'open',
      note: foldedMatches[0],
      canonicalInner: buildCanonicalInnerForOpen({
        parsed,
        canonicalStem,
        hadInboxPrefix,
      }),
    };
  }
  if (foldedMatches.length > 1) {
    return {
      kind: 'ambiguous',
      notes: foldedMatches,
      targetStem: stem,
      title,
    };
  }

  const linkStemKey = buildSanitizedStemKey(stem);
  if (linkStemKey) {
    const sanitizedMatches = [...(lookup.bySanitizedKey.get(linkStemKey) ?? [])];
    if (sanitizedMatches.length === 1) {
      const canonicalStem = stemFromMarkdownFileName(sanitizedMatches[0].name);
      return {
        kind: 'open',
        note: sanitizedMatches[0],
        canonicalInner: buildCanonicalInnerForOpen({
          parsed,
          canonicalStem,
          hadInboxPrefix,
        }),
      };
    }
    if (sanitizedMatches.length > 1) {
      return {
        kind: 'ambiguous',
        notes: sanitizedMatches,
        targetStem: stem,
        title,
      };
    }
  }

  return {kind: 'create', title};
}

/**
 * Inbox-only resolver for `[[...]]` links.
 * - Supports `[[target]]` and `[[target|display]]`.
 * - Optional `Inbox/` prefix is stripped case-insensitively.
 * - No broader path semantics or fuzzy matching.
 */
export function resolveInboxWikiLinkTarget(
  notes: ReadonlyArray<InboxWikiLinkNoteRef>,
  inner: string,
): InboxWikiLinkResolveResult {
  const parsed = splitWikiLinkInner(inner);
  const normalized = normalizeTargetToStem(parsed.targetText);
  if (normalized.kind === 'unsupported') {
    return {kind: 'unsupported', reason: normalized.reason};
  }

  const {pathlessTarget, stem, hadInboxPrefix} = normalized;
  const exactMatches = notes.filter(n => stemFromMarkdownFileName(n.name) === stem);
  if (exactMatches.length === 1) {
    return {kind: 'open', note: exactMatches[0]};
  }

  const title = parsed.displayText ?? pathlessTarget;
  if (exactMatches.length > 1) {
    return {
      kind: 'ambiguous',
      notes: exactMatches,
      targetStem: stem,
      title,
    };
  }

  const foldedStem = stem.toLowerCase();
  const foldedMatches = notes.filter(
    n => stemFromMarkdownFileName(n.name).toLowerCase() === foldedStem,
  );
  if (foldedMatches.length === 1) {
    const canonicalStem = stemFromMarkdownFileName(foldedMatches[0].name);
    return {
      kind: 'open',
      note: foldedMatches[0],
      canonicalInner: buildCanonicalInnerForOpen({
        parsed,
        canonicalStem,
        hadInboxPrefix,
      }),
    };
  }
  if (foldedMatches.length > 1) {
    return {
      kind: 'ambiguous',
      notes: foldedMatches,
      targetStem: stem,
      title,
    };
  }

  const linkStemKey = buildSanitizedStemKey(stem);
  if (linkStemKey) {
    const sanitizedMatches = notes.filter(n => {
      const noteStem = stemFromMarkdownFileName(n.name);
      return buildSanitizedStemKey(noteStem) === linkStemKey;
    });
    if (sanitizedMatches.length === 1) {
      const canonicalStem = stemFromMarkdownFileName(sanitizedMatches[0].name);
      return {
        kind: 'open',
        note: sanitizedMatches[0],
        canonicalInner: buildCanonicalInnerForOpen({
          parsed,
          canonicalStem,
          hadInboxPrefix,
        }),
      };
    }
    if (sanitizedMatches.length > 1) {
      return {
        kind: 'ambiguous',
        notes: sanitizedMatches,
        targetStem: stem,
        title,
      };
    }
  }

  return {kind: 'create', title};
}
