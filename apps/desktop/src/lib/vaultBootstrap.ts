import {desktopR2SignedTransport} from './desktopR2Transport';

import {
  assertVaultMarkdownNoteUriForCrud,
  assertVaultTreeDirectoryUriForCrud,
  defaultEskerraLocalSettings,
  deleteR2PlaylistObject,
  ensureDeviceInstanceId,
  getAssetsAttachmentsDirectoryUri,
  getGeneralDirectoryUri,
  getInboxDirectoryUri,
  getLocalSettingsUri,
  getEskerraDirectoryUri,
  getPlaylistUri,
  getR2PlaylistObject,
  getSharedSettingsUri,
  initEskerraVault,
  isRemotePlaylistNewerThanKnown,
  isSyncConflictFileName,
  isVaultR2PlaylistConfigured,
  MARKDOWN_EXTENSION,
  normalizeVaultBaseUri,
  parseEskerraLocalSettings,
  parseEskerraSettings,
  pickNextInboxMarkdownFileName,
  putR2PlaylistObject,
  readVaultSharedSettingsRaw,
  sanitizeFileName,
  sanitizeInboxNoteStem,
  serializeEskerraLocalSettings,
  serializeEskerraSettings,
  trimTrailingSlashes,
  vaultPathDirname,
  type EskerraLocalSettings,
  type EskerraSettings,
  type PlaylistEntry,
  type PlaylistWriteResult,
  type VaultFilesystem,
} from '@eskerra/core';

const DESKTOP_R2_HTTP = {transport: desktopR2SignedTransport} as const;

export async function bootstrapVaultLayout(
  root: string,
  fs: VaultFilesystem,
): Promise<void> {
  const base = normalizeVaultBaseUri(root);
  await initEskerraVault(base, fs);
  const inbox = getInboxDirectoryUri(base);
  const general = getGeneralDirectoryUri(base);
  if (!(await fs.exists(inbox))) {
    await fs.mkdir(inbox);
  }
  if (!(await fs.exists(general))) {
    await fs.mkdir(general);
  }
  const attachments = getAssetsAttachmentsDirectoryUri(base);
  if (!(await fs.exists(attachments))) {
    await fs.mkdir(attachments);
  }
}

async function migrateLegacySharedDisplayNameIfNeeded(
  root: string,
  fs: VaultFilesystem,
  rawShared: string,
  normalizedSettings: EskerraSettings,
): Promise<void> {
  let loose: Record<string, unknown>;
  try {
    loose = JSON.parse(rawShared) as Record<string, unknown>;
  } catch {
    return;
  }

  if (!('displayName' in loose)) {
    return;
  }

  const legacy = typeof loose.displayName === 'string' ? loose.displayName : '';
  const legacyDisplay = legacy.trim();
  if (legacyDisplay !== '') {
    const local = await readVaultLocalSettings(root, fs);
    if (local.displayName === '') {
      await writeVaultLocalSettings(root, fs, {...local, displayName: legacyDisplay});
    }
  }

  await writeVaultSettings(root, fs, normalizedSettings);
}

export async function readVaultSettings(
  root: string,
  fs: VaultFilesystem,
): Promise<EskerraSettings> {
  const base = normalizeVaultBaseUri(root);
  const raw = await readVaultSharedSettingsRaw(base, fs);
  const settings = parseEskerraSettings(raw);
  await migrateLegacySharedDisplayNameIfNeeded(root, fs, raw, settings);
  return settings;
}

export async function writeVaultSettings(
  root: string,
  fs: VaultFilesystem,
  settings: EskerraSettings,
): Promise<void> {
  const base = normalizeVaultBaseUri(root);
  const settingsUri = getSharedSettingsUri(base);
  await fs.writeFile(settingsUri, serializeEskerraSettings(settings), {
    encoding: 'utf8',
    mimeType: 'application/json',
  });
}

export async function readVaultLocalSettings(
  root: string,
  fs: VaultFilesystem,
): Promise<EskerraLocalSettings> {
  const base = normalizeVaultBaseUri(root);
  const localUri = getLocalSettingsUri(base);
  if (!(await fs.exists(localUri))) {
    return defaultEskerraLocalSettings;
  }
  const raw = await fs.readFile(localUri, {encoding: 'utf8'});
  return parseEskerraLocalSettings(raw);
}

export async function writeVaultLocalSettings(
  root: string,
  fs: VaultFilesystem,
  settings: EskerraLocalSettings,
): Promise<void> {
  const base = normalizeVaultBaseUri(root);
  const eskerraDir = getEskerraDirectoryUri(base);
  if (!(await fs.exists(eskerraDir))) {
    await fs.mkdir(eskerraDir);
  }
  const localUri = getLocalSettingsUri(base);
  await fs.writeFile(localUri, serializeEskerraLocalSettings(settings), {
    encoding: 'utf8',
    mimeType: 'application/json',
  });
}

export async function listInboxNotes(root: string, fs: VaultFilesystem) {
  const base = normalizeVaultBaseUri(root);
  const inbox = getInboxDirectoryUri(base);
  if (!(await fs.exists(inbox))) {
    return [];
  }
  const rows = await fs.listFiles(inbox);
  return rows
    .filter(
      r =>
        (r.type === 'file' || r.type === undefined) &&
        r.name.endsWith(MARKDOWN_EXTENSION) &&
        !isSyncConflictFileName(r.name),
    )
    .map(r => ({
      lastModified: r.lastModified,
      name: r.name,
      uri: r.uri,
    }))
    .sort((a, b) => {
      // Most recently modified first (same comparator as mobile sortByLastModifiedDesc).
      const delta = (b.lastModified ?? 0) - (a.lastModified ?? 0);
      if (delta !== 0) {
        return delta;
      }
      return a.name.localeCompare(b.name);
    });
}

async function persistPlaylistKnownDesktop(
  root: string,
  fs: VaultFilesystem,
  nextUpdatedAtMs: number | null,
  nextControlRevision: number | null,
): Promise<void> {
  const local = await readVaultLocalSettings(root, fs);
  if (
    local.playlistKnownUpdatedAtMs === nextUpdatedAtMs &&
    local.playlistKnownControlRevision === nextControlRevision
  ) {
    return;
  }
  await writeVaultLocalSettings(root, fs, {
    ...local,
    playlistKnownUpdatedAtMs: nextUpdatedAtMs,
    playlistKnownControlRevision: nextControlRevision,
  });
}

export async function readPlaylistEntry(
  root: string,
  fs: VaultFilesystem,
): Promise<PlaylistEntry | null> {
  const settings = await readVaultSettings(root, fs);

  if (!isVaultR2PlaylistConfigured(settings)) {
    await persistPlaylistKnownDesktop(root, fs, null, null);
    return null;
  }

  try {
    const r2Entry = await getR2PlaylistObject(settings.r2, DESKTOP_R2_HTTP);
    await persistPlaylistKnownDesktop(
      root,
      fs,
      r2Entry?.updatedAt ?? null,
      r2Entry?.controlRevision ?? null,
    );
    return r2Entry;
  } catch {
    await persistPlaylistKnownDesktop(root, fs, null, null);
    return null;
  }
}

export async function writePlaylistEntry(
  root: string,
  fs: VaultFilesystem,
  entry: PlaylistEntry,
): Promise<PlaylistWriteResult> {
  let localMeta = await readVaultLocalSettings(root, fs);
  const ensured = ensureDeviceInstanceId(localMeta);
  if (ensured.changed) {
    localMeta = ensured.settings;
    await writeVaultLocalSettings(root, fs, localMeta);
  }

  const knownUpdated = localMeta.playlistKnownUpdatedAtMs ?? 0;
  const knownRev = localMeta.playlistKnownControlRevision ?? 0;

  const settings = await readVaultSettings(root, fs);
  const hasR2 = isVaultR2PlaylistConfigured(settings);

  if (!hasR2) {
    return {kind: 'skipped'};
  }

  const remote = await getR2PlaylistObject(settings.r2, DESKTOP_R2_HTTP);
  if (remote != null && isRemotePlaylistNewerThanKnown(remote, knownUpdated, knownRev)) {
    await persistPlaylistKnownDesktop(root, fs, remote.updatedAt, remote.controlRevision);
    return {kind: 'superseded', entry: remote};
  }

  const nextTs = Math.max(Date.now(), remote?.updatedAt ?? 0, knownUpdated, entry.updatedAt);
  const saved: PlaylistEntry = {...entry, updatedAt: nextTs};
  await putR2PlaylistObject(settings.r2, saved, DESKTOP_R2_HTTP);
  await persistPlaylistKnownDesktop(root, fs, saved.updatedAt, saved.controlRevision);
  return {kind: 'saved', entry: saved};
}

/** Removes remote `playlist.json` when R2 is configured; unlinks legacy local mirror if present. */
export async function clearPlaylistEntry(root: string, fs: VaultFilesystem): Promise<void> {
  const base = normalizeVaultBaseUri(root);
  const uri = getPlaylistUri(base);
  const settings = await readVaultSettings(root, fs);

  if (isVaultR2PlaylistConfigured(settings)) {
    await deleteR2PlaylistObject(settings.r2, DESKTOP_R2_HTTP);
  }

  await persistPlaylistKnownDesktop(root, fs, null, null);

  if (await fs.exists(uri)) {
    await fs.unlink(uri);
  }
}

/**
 * Creates a markdown note under an existing vault directory (validated for tree CRUD).
 */
export async function createVaultMarkdownNoteInDirectory(
  root: string,
  fs: VaultFilesystem,
  parentDirectoryUri: string,
  title: string,
  markdownBody: string,
): Promise<{lastModified: number; name: string; uri: string}> {
  const base = normalizeVaultBaseUri(root);
  const parent = assertVaultTreeDirectoryUriForCrud(base, parentDirectoryUri)
    .replace(/\\/g, '/')
    .trim();
  const normalizedParent = trimTrailingSlashes(parent);
  if (!(await fs.exists(normalizedParent))) {
    await fs.mkdir(normalizedParent);
  }
  const rows = await fs.listFiles(normalizedParent);
  const occupied = new Set(
    rows
      .filter(
        r =>
          (r.type === 'file' || r.type === undefined) &&
          r.name.endsWith(MARKDOWN_EXTENSION),
      )
      .map(r => r.name),
  );
  const stem = sanitizeFileName(title);
  const fileName = pickNextInboxMarkdownFileName(stem, occupied);
  const uri = `${normalizedParent}/${fileName}`;
  await fs.writeFile(uri, markdownBody, {
    encoding: 'utf8',
    mimeType: 'text/markdown',
  });
  return {lastModified: Date.now(), name: fileName, uri};
}

export async function createInboxMarkdownNote(
  root: string,
  fs: VaultFilesystem,
  title: string,
  markdownBody: string,
): Promise<{lastModified: number; name: string; uri: string}> {
  const base = normalizeVaultBaseUri(root);
  const inbox = getInboxDirectoryUri(base);
  return createVaultMarkdownNoteInDirectory(root, fs, inbox, title, markdownBody);
}

export async function deleteVaultMarkdownNote(
  root: string,
  noteUri: string,
  fs: VaultFilesystem,
): Promise<void> {
  const normalized = assertVaultMarkdownNoteUriForCrud(root, noteUri);
  await fs.unlink(normalized);
}

export async function deleteVaultTreeDirectory(
  root: string,
  directoryUri: string,
  fs: VaultFilesystem,
): Promise<void> {
  const normalized = assertVaultTreeDirectoryUriForCrud(root, directoryUri);
  await fs.removeTree(normalized);
}

export async function renameVaultTreeDirectory(
  root: string,
  directoryUri: string,
  nextDisplayName: string,
  fs: VaultFilesystem,
): Promise<string> {
  const normalized = assertVaultTreeDirectoryUriForCrud(root, directoryUri);
  const sanitized = sanitizeInboxNoteStem(nextDisplayName);
  if (!sanitized) {
    throw new Error('Folder name cannot be empty.');
  }
  if (sanitized.includes('/') || sanitized.includes('\\')) {
    throw new Error('Folder name cannot contain path separators.');
  }
  const parentDir = vaultPathDirname(normalized);
  const nextUri = `${parentDir}/${sanitized}`;
  const currentName = normalized.split('/').pop() ?? '';
  if (sanitized === currentName) {
    return normalized;
  }
  if (await fs.exists(nextUri)) {
    throw new Error('A folder or file with this name already exists.');
  }
  await fs.renameFile(normalized, nextUri);
  return nextUri;
}

export async function renameVaultMarkdownNote(
  root: string,
  noteUri: string,
  nextDisplayName: string,
  fs: VaultFilesystem,
): Promise<string> {
  const normalized = assertVaultMarkdownNoteUriForCrud(root, noteUri);

  const sanitizedStem = sanitizeInboxNoteStem(nextDisplayName);
  if (!sanitizedStem) {
    throw new Error('Note name cannot be empty.');
  }
  const nextName = `${sanitizedStem}${MARKDOWN_EXTENSION}`;
  const currentFileName = normalized.split('/').pop() ?? '';
  if (nextName === currentFileName) {
    return normalized;
  }
  const parentDir = vaultPathDirname(normalized);
  const nextUri = `${parentDir}/${nextName}`;
  if (await fs.exists(nextUri)) {
    throw new Error('A note with this name already exists.');
  }
  await fs.renameFile(normalized, nextUri);
  return nextUri;
}

export type MoveVaultTreeItemResult = {
  previousUri: string;
  nextUri: string;
  movedKind: 'folder' | 'article';
};

/**
 * Moves a vault tree item (markdown note or user folder) into `targetDirectoryUri` via `renameFile`.
 * Preserves the base name; rejects collisions and invalid moves (for example folder into itself).
 */
export async function moveVaultTreeItemToDirectory(
  root: string,
  fs: VaultFilesystem,
  options: {
    sourceUri: string;
    sourceKind: 'folder' | 'article';
    targetDirectoryUri: string;
  },
): Promise<MoveVaultTreeItemResult> {
  const normTarget = assertVaultTreeDirectoryUriForCrud(root, options.targetDirectoryUri)
    .replace(/\\/g, '/')
    .trim();
  const normalizedTarget = trimTrailingSlashes(normTarget);

  let normalizedSource: string;
  let movedKind: 'folder' | 'article';
  if (options.sourceKind === 'article') {
    normalizedSource = assertVaultMarkdownNoteUriForCrud(root, options.sourceUri);
    movedKind = 'article';
  } else {
    const rawSource = assertVaultTreeDirectoryUriForCrud(
      root,
      options.sourceUri,
    ).replace(/\\/g, '/').trim();
    normalizedSource = trimTrailingSlashes(rawSource);
    movedKind = 'folder';
  }

  if (movedKind === 'folder' && normalizedTarget === normalizedSource) {
    return {previousUri: normalizedSource, nextUri: normalizedSource, movedKind};
  }

  const baseName = normalizedSource.split('/').pop() ?? '';
  const nextUri = `${normalizedTarget}/${baseName}`;

  if (nextUri === normalizedSource) {
    return {previousUri: normalizedSource, nextUri: normalizedSource, movedKind};
  }

  if (movedKind === 'folder') {
    if (normTarget.startsWith(`${normalizedSource}/`)) {
      throw new Error('Cannot move a folder into its own subfolder.');
    }
  }

  if (await fs.exists(nextUri)) {
    throw new Error('A folder or file with this name already exists.');
  }

  await fs.renameFile(normalizedSource, nextUri);
  return {previousUri: normalizedSource, nextUri, movedKind};
}

export async function saveNoteMarkdown(
  noteUri: string,
  fs: VaultFilesystem,
  markdownBody: string,
): Promise<void> {
  await fs.writeFile(noteUri, markdownBody, {
    encoding: 'utf8',
    mimeType: 'text/markdown',
  });
}
