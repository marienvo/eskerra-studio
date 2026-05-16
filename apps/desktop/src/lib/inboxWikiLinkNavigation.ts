import {
  assertVaultMarkdownNoteUriForCrud,
  assertVaultTreeDirectoryUriForCrud,
  buildInboxMarkdownFromCompose,
  buildWikiLinkInnerForCreatedStem,
  getInboxDirectoryUri,
  normalizeVaultBaseUri,
  resolveInboxWikiLinkTarget,
  resolveVaultRelativeMarkdownHref,
  stemFromMarkdownFileName,
  trimTrailingSlashes,
  vaultPathDirname,
  wikiLinkInnerBrowserOpenableHref,
  wikiLinkInnerPathResolutionSourceDirectoryUri,
  wikiLinkInnerVaultRelativeMarkdownHref,
  type InboxWikiLinkNoteRef,
  type InboxWikiLinkResolveResult,
  type VaultFilesystem,
} from '@eskerra/core';

import {createVaultMarkdownNoteInDirectory} from './vaultBootstrap';

export type InboxWikiLinkNavigationResult =
  | {kind: 'open'; uri: string; canonicalInner?: string}
  | {kind: 'created'; uri: string; canonicalInner?: string}
  | {
      kind: 'ambiguous';
      targetStem: string;
      title: string;
      notes: ReadonlyArray<InboxWikiLinkNoteRef>;
    }
  | {kind: 'unsupported'; reason: 'empty_target' | 'path_not_supported'};

/**
 * Shell-owned wiki-link flow: resolve against the vault markdown ref index, or create a new note
 * beside the active note’s folder (else Inbox) using the shared title→filename policy.
 * When {@link newNoteParentDirectory} is set, it overrides the create parent (e.g. Today hub → General).
 */
export async function openOrCreateInboxWikiLinkTarget(options: {
  inner: string;
  notes: ReadonlyArray<InboxWikiLinkNoteRef>;
  vaultRoot: string;
  fs: VaultFilesystem;
  /** Open `.md` URI whose parent directory receives new notes; omit or null → Inbox. */
  activeMarkdownUri?: string | null;
  /** Vault directory URI for new notes; wins over Inbox / active note parent when creating. */
  newNoteParentDirectory?: string | null;
}): Promise<InboxWikiLinkNavigationResult> {
  const {inner, notes, vaultRoot, fs, activeMarkdownUri, newNoteParentDirectory} = options;
  const resolved: InboxWikiLinkResolveResult = resolveInboxWikiLinkTarget(
    notes,
    inner,
  );

  if (resolved.kind === 'open') {
    return {
      kind: 'open',
      uri: resolved.note.uri,
      canonicalInner: resolved.canonicalInner,
    };
  }
  if (resolved.kind === 'ambiguous') {
    return {
      kind: 'ambiguous',
      targetStem: resolved.targetStem,
      title: resolved.title,
      notes: resolved.notes,
    };
  }
  if (resolved.kind === 'unsupported') {
    return {kind: 'unsupported', reason: resolved.reason};
  }

  const base = normalizeVaultBaseUri(vaultRoot);
  const inbox = getInboxDirectoryUri(base);
  let parentDir = inbox;
  if (newNoteParentDirectory) {
    parentDir = assertVaultTreeDirectoryUriForCrud(vaultRoot, newNoteParentDirectory)
      .replace(/\\/g, '/')
      .trim();
    parentDir = trimTrailingSlashes(parentDir);
  } else if (activeMarkdownUri) {
    const noteUri = assertVaultMarkdownNoteUriForCrud(vaultRoot, activeMarkdownUri);
    parentDir = vaultPathDirname(noteUri);
  }

  const markdown = buildInboxMarkdownFromCompose(resolved.title, '');
  const created = await createVaultMarkdownNoteInDirectory(
    vaultRoot,
    fs,
    parentDir,
    resolved.title,
    markdown,
  );
  const createdStem = stemFromMarkdownFileName(created.name);
  const canonicalInner = buildWikiLinkInnerForCreatedStem(inner, createdStem) ?? undefined;
  return canonicalInner != null
    ? {kind: 'created', uri: created.uri, canonicalInner}
    : {kind: 'created', uri: created.uri};
}

/**
 * True when `inner` resolves to exactly one existing inbox note (same rule as navigation `open`),
 * or when the target is a browser-openable `http` / `https` / `mailto` URL (desktop external wiki),
 * or when `vaultPathContext` is set and `inner` is a path-shaped `.md` target that resolves as a
 * vault-relative markdown link from `sourceMarkdownUriOrDir`.
 */
export function inboxWikiLinkTargetIsResolved(
  notes: ReadonlyArray<InboxWikiLinkNoteRef>,
  inner: string,
  vaultPathContext?: {
    vaultRoot: string;
    sourceMarkdownUriOrDir: string;
  },
): boolean {
  if (wikiLinkInnerBrowserOpenableHref(inner) != null) {
    return true;
  }
  if (resolveInboxWikiLinkTarget(notes, inner).kind === 'open') {
    return true;
  }
  if (vaultPathContext) {
    const href = wikiLinkInnerVaultRelativeMarkdownHref(inner);
    if (href != null) {
      const fallback = vaultPathContext.sourceMarkdownUriOrDir;
      const vaultSource = wikiLinkInnerPathResolutionSourceDirectoryUri(
        vaultPathContext.vaultRoot,
        inner,
        fallback,
      );
      const roots =
        normVaultUri(vaultSource).toLowerCase() === normVaultUri(fallback).toLowerCase()
          ? [fallback]
          : [vaultSource, fallback];
      return roots.some(
        sourceDir =>
          resolveVaultRelativeMarkdownHref(
            vaultPathContext.vaultRoot,
            sourceDir,
            href,
            notes,
          ) != null,
      );
    }
  }
  return false;
}

export type InboxRelativeMarkdownLinkNavigationResult =
  | {kind: 'open'; uri: string; canonicalHref?: string}
  | {kind: 'created'; uri: string; canonicalHref?: string}
  | {kind: 'unsupported'}
  /** Resolved path is not on disk and parent uses tree-ignored segments (e.g. `_autosync-backup`). */
  | {kind: 'cannot_create_parent'; resolvedUri: string};

function normVaultUri(u: string): string {
  return u.trim().replace(/\\/g, '/');
}

/** Tries `vault_exists` for the path and Unicode NFC/NFD variants (sync tools may differ from editor bytes). */
async function firstExistingVaultMarkdownUri(
  fs: VaultFilesystem,
  uri: string,
): Promise<string | null> {
  const trimmed = uri.trim();
  const variants = new Set<string>([trimmed]);
  try {
    variants.add(trimmed.normalize('NFC'));
    variants.add(trimmed.normalize('NFD'));
  } catch {
    /* ignore */
  }
  for (const v of variants) {
    if (v !== '' && (await fs.exists(v))) {
      return v;
    }
  }
  return null;
}

function markdownBasenameFromUri(uri: string): string {
  const n = uri.trim().replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

function stripVariationSelectors(s: string): string {
  return s.replace(/\uFE0F/g, '');
}

/** Collapses emoji to one placeholder so backup copies with slightly different glyphs still match. */
function roughBackupBasenameKey(name: string): string {
  const z = stripVariationSelectors(name)
    .replace(/\p{Extended_Pictographic}/gu, '\uFFFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return z;
}

function basenameMatchVariants(expectedBasename: string): Set<string> {
  const out = new Set<string>();
  for (const x of [
    expectedBasename,
    expectedBasename.normalize('NFC'),
    expectedBasename.normalize('NFD'),
    stripVariationSelectors(expectedBasename),
    stripVariationSelectors(expectedBasename).normalize('NFC'),
    stripVariationSelectors(expectedBasename).normalize('NFD'),
  ]) {
    out.add(x);
  }
  return out;
}

/**
 * When `vault_exists` misses (emoji / VS16 / sync naming), list the parent directory and pick
 * one `.md` file: exact variant match, case-insensitive basename, unique `--YYYYMMDD-HHMMSS.md`
 * suffix, or unique "rough" basename (emoji collapsed).
 */
async function tryResolveMarkdownFileByListingParent(
  fs: VaultFilesystem,
  resolvedFileUri: string,
): Promise<string | null> {
  const parent = trimTrailingSlashes(vaultPathDirname(resolvedFileUri));
  const expectedBasename = markdownBasenameFromUri(resolvedFileUri);
  let entries: Awaited<ReturnType<VaultFilesystem['listFiles']>>;
  try {
    entries = await fs.listFiles(parent);
  } catch {
    return null;
  }
  const mdFiles = entries.filter(
    e =>
      (e.type === 'file' || e.type === undefined) &&
      e.name.toLowerCase().endsWith('.md'),
  );
  const targets = basenameMatchVariants(expectedBasename);
  for (const e of mdFiles) {
    const nv = new Set([
      e.name,
      e.name.normalize('NFC'),
      stripVariationSelectors(e.name),
      stripVariationSelectors(e.name).normalize('NFC'),
    ]);
    for (const t of targets) {
      if (nv.has(t)) {
        return e.uri.trim().replace(/\\/g, '/');
      }
    }
  }
  const want = expectedBasename.toLowerCase();
  const ci = mdFiles.filter(e => e.name.toLowerCase() === want);
  if (ci.length === 1) {
    return ci[0]!.uri.trim().replace(/\\/g, '/');
  }
  const suf = /--\d{8}-\d{6}\.md$/i.exec(expectedBasename);
  if (suf) {
    const tail = suf[0]!.toLowerCase();
    const bySuffix = mdFiles.filter(e => e.name.toLowerCase().endsWith(tail));
    if (bySuffix.length === 1) {
      return bySuffix[0]!.uri.trim().replace(/\\/g, '/');
    }
  }
  const rough = roughBackupBasenameKey(expectedBasename);
  const roughHits = mdFiles.filter(e => roughBackupBasenameKey(e.name) === rough);
  if (roughHits.length === 1) {
    return roughHits[0]!.uri.trim().replace(/\\/g, '/');
  }
  return null;
}

async function tryOpenVaultRelativeMarkdownFromHref(options: {
  vaultRoot: string;
  sourceMarkdownUriOrDir: string;
  href: string;
  notes: ReadonlyArray<InboxWikiLinkNoteRef>;
  fs: VaultFilesystem;
}): Promise<{kind: 'open'; uri: string; canonicalHref?: string} | null> {
  const {vaultRoot, sourceMarkdownUriOrDir, href, notes, fs} = options;
  const resolved = resolveVaultRelativeMarkdownHref(
    vaultRoot,
    sourceMarkdownUriOrDir,
    href,
    notes,
  );
  if (!resolved) {
    return null;
  }
  const exists = notes.some(
    n => normVaultUri(n.uri).toLowerCase() === normVaultUri(resolved.uri).toLowerCase(),
  );
  if (exists) {
    return {
      kind: 'open',
      uri: resolved.uri,
      canonicalHref: resolved.canonicalHref,
    };
  }
  let onDiskUri = await firstExistingVaultMarkdownUri(fs, resolved.uri);
  const viaList =
    onDiskUri == null ? await tryResolveMarkdownFileByListingParent(fs, resolved.uri) : null;
  if (viaList != null) {
    onDiskUri = viaList;
  }
  if (onDiskUri != null) {
    return {
      kind: 'open',
      uri: onDiskUri,
      canonicalHref: resolved.canonicalHref,
    };
  }
  return null;
}

/**
 * Path-shaped wiki link `[[.../note.md]]`: try vault-root (and Inbox-prefixed) resolution first, then
 * the same relative join as an inline `[](href)` from the open surface (Today hub / active note),
 * so Syncthing-style backups at the vault root open while `General/_backup/...` layouts still work.
 */
export async function openOrCreateVaultWikiPathMarkdownLink(options: {
  inner: string;
  notes: ReadonlyArray<InboxWikiLinkNoteRef>;
  vaultRoot: string;
  fs: VaultFilesystem;
  fallbackSourceMarkdownUriOrDir: string;
}): Promise<InboxRelativeMarkdownLinkNavigationResult> {
  const pathHref = wikiLinkInnerVaultRelativeMarkdownHref(options.inner);
  if (pathHref == null) {
    return {kind: 'unsupported'};
  }
  const {notes, vaultRoot, fs, fallbackSourceMarkdownUriOrDir: fallback} = options;
  const vaultSource = wikiLinkInnerPathResolutionSourceDirectoryUri(
    vaultRoot,
    options.inner,
    fallback,
  );
  const sources =
    normVaultUri(vaultSource).toLowerCase() === normVaultUri(fallback).toLowerCase()
      ? [fallback]
      : [vaultSource, fallback];

  for (const sourceMarkdownUriOrDir of sources) {
    const opened = await tryOpenVaultRelativeMarkdownFromHref({
      vaultRoot,
      sourceMarkdownUriOrDir,
      href: pathHref,
      notes,
      fs,
    });
    if (opened) {
      return opened;
    }
  }

  for (const sourceMarkdownUriOrDir of sources) {
    const result = await openOrCreateVaultRelativeMarkdownLink({
      href: pathHref,
      notes,
      vaultRoot,
      fs,
      sourceMarkdownUriOrDir,
    });
    if (result.kind === 'open' || result.kind === 'created') {
      return result;
    }
    if (result.kind === 'cannot_create_parent') {
      continue;
    }
    if (result.kind === 'unsupported') {
      continue;
    }
  }
  const lastSource = sources[sources.length - 1]!;
  const lastResolved = resolveVaultRelativeMarkdownHref(vaultRoot, lastSource, pathHref, notes);
  return lastResolved
    ? {kind: 'cannot_create_parent', resolvedUri: lastResolved.uri}
    : {kind: 'unsupported'};
}

/**
 * Opens or creates the vault note targeted by a relative `[](*.md)` href from the current note
 * (or Inbox directory when composing).
 */
export async function openOrCreateVaultRelativeMarkdownLink(options: {
  href: string;
  notes: ReadonlyArray<InboxWikiLinkNoteRef>;
  vaultRoot: string;
  fs: VaultFilesystem;
  /** Directory or open `.md` URI — see `resolveVaultRelativeMarkdownHref` in `@eskerra/core`. */
  sourceMarkdownUriOrDir: string;
}): Promise<InboxRelativeMarkdownLinkNavigationResult> {
  const {href, notes, vaultRoot, fs, sourceMarkdownUriOrDir} = options;
  const resolved = resolveVaultRelativeMarkdownHref(
    vaultRoot,
    sourceMarkdownUriOrDir,
    href,
    notes,
  );
  if (!resolved) {
    return {kind: 'unsupported'};
  }

  const opened = await tryOpenVaultRelativeMarkdownFromHref({
    vaultRoot,
    sourceMarkdownUriOrDir,
    href,
    notes,
    fs,
  });
  if (opened) {
    return opened;
  }

  const parentDir = vaultPathDirname(resolved.uri);

  try {
    assertVaultTreeDirectoryUriForCrud(normalizeVaultBaseUri(vaultRoot), parentDir);
  } catch {
    return {kind: 'cannot_create_parent', resolvedUri: resolved.uri};
  }

  const fileName = resolved.uri.split('/').pop() ?? '';
  const stem = stemFromMarkdownFileName(fileName);
  const markdown = buildInboxMarkdownFromCompose(stem, '');
  const created = await createVaultMarkdownNoteInDirectory(
    vaultRoot,
    fs,
    parentDir,
    stem,
    markdown,
  );
  const createdFileName = created.name;
  const hrefDir = href.includes('/')
    ? href.slice(0, href.lastIndexOf('/') + 1)
    : '';
  const canonicalHref =
    createdFileName !== fileName ? `${hrefDir}${createdFileName}` : undefined;
  return canonicalHref != null
    ? {kind: 'created', uri: created.uri, canonicalHref}
    : {kind: 'created', uri: created.uri};
}

export function inboxRelativeMarkdownLinkHrefIsResolved(
  notes: ReadonlyArray<InboxWikiLinkNoteRef>,
  sourceMarkdownUriOrDir: string,
  vaultRoot: string,
  href: string,
): boolean {
  const resolved = resolveVaultRelativeMarkdownHref(
    vaultRoot,
    sourceMarkdownUriOrDir,
    href,
    notes,
  );
  if (!resolved) {
    return false;
  }
  return notes.some(
    n => normVaultUri(n.uri).toLowerCase() === normVaultUri(resolved.uri).toLowerCase(),
  );
}
