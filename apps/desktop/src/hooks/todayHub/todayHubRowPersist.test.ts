// @vitest-environment happy-dom
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {SubtreeMarkdownPresenceCache, type VaultFilesystem} from '@eskerra/core';

import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';
import * as vaultBootstrap from '../../lib/vaultBootstrap';
import {
  enqueuePersistTodayHubRowOnSaveChain,
  prehydrateTodayHubRowsFromDisk,
  type TodayHubRowPersistDeps,
} from './todayHubRowPersist';

vi.mock('../../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: vi.fn(async (md: string) => md),
}));

vi.mock('../../lib/vaultBootstrap', () => ({
  saveNoteMarkdown: vi.fn().mockResolvedValue(undefined),
  deleteVaultMarkdownNote: vi.fn().mockResolvedValue(undefined),
}));

function ref<T>(current: T): {current: T} {
  return {current};
}

function makeDeps(overrides: Partial<TodayHubRowPersistDeps> = {}): TodayHubRowPersistDeps {
  const fs = {
    exists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
  } as unknown as VaultFilesystem;
  return {
    fs,
    vaultRootRef: ref<string | null>(null),
    saveChainRef: ref(Promise.resolve()),
    inboxContentByUriRef: ref({}),
    setInboxContentByUri: vi.fn(),
    todayHubRowLastPersistedRef: ref(new Map<string, string>()),
    setErr: vi.fn(),
    markVaultWriteSettled: vi.fn(),
    subtreeMarkdownCache: new SubtreeMarkdownPresenceCache(),
    refreshNotes: vi.fn().mockResolvedValue(undefined),
    setFsRefreshNonce: vi.fn(),
    ...overrides,
  };
}

describe('todayHubRowPersist', () => {
  beforeEach(() => {
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockClear();
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockResolvedValue(undefined);
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockClear();
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockResolvedValue(undefined);
  });

  it('prehydrateTodayHubRowsFromDisk is a no-op when vaultRootRef is null', async () => {
    const exists = vi.fn();
    const readFile = vi.fn();
    const fs = {exists, readFile} as unknown as VaultFilesystem;
    await prehydrateTodayHubRowsFromDisk(['/vault/x.md'], makeDeps({fs}));

    expect(exists).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('prehydrateTodayHubRowsFromDisk skips URIs already present in the inbox body cache', async () => {
    const rowUri = '/vault/Today.md';
    const norm = normalizeEditorDocUri(rowUri)!;
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('# disk'),
    } as unknown as VaultFilesystem;
    const inboxContentByUriRef = ref({[norm]: '# cached'});
    const todayHubRowLastPersistedRef = ref(new Map<string, string>());
    await prehydrateTodayHubRowsFromDisk(
      [rowUri],
      makeDeps({
        fs,
        vaultRootRef: ref('/vault'),
        inboxContentByUriRef,
        todayHubRowLastPersistedRef,
      }),
    );

    expect(fs.exists).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(todayHubRowLastPersistedRef.current.has(norm)).toBe(false);
  });

  it('prehydrateTodayHubRowsFromDisk skips missing row files', async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(false),
      readFile: vi.fn(),
    } as unknown as VaultFilesystem;
    const setInboxContentByUri = vi.fn();
    await prehydrateTodayHubRowsFromDisk(
      ['/vault/Missing.md'],
      makeDeps({fs, vaultRootRef: ref('/vault'), setInboxContentByUri}),
    );

    expect(fs.exists).toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(setInboxContentByUri).not.toHaveBeenCalled();
  });

  it('prehydrateTodayHubRowsFromDisk reads disk into the inbox cache and last-persisted map', async () => {
    const rowUri = '/vault/Hub/Row.md';
    const norm = normalizeEditorDocUri(rowUri)!;
    const raw = '# body\n';
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue(raw),
    } as unknown as VaultFilesystem;
    const inboxContentByUriRef = ref<Record<string, string>>({});
    const todayHubRowLastPersistedRef = ref(new Map<string, string>());
    const setInboxContentByUri = vi.fn();
    await prehydrateTodayHubRowsFromDisk(
      [rowUri],
      makeDeps({
        fs,
        vaultRootRef: ref('/vault'),
        inboxContentByUriRef,
        todayHubRowLastPersistedRef,
        setInboxContentByUri,
      }),
    );

    const cached = inboxContentByUriRef.current[norm];
    expect(cached).toBeDefined();
    expect(todayHubRowLastPersistedRef.current.get(norm)).toBe(cached);
    expect(setInboxContentByUri).toHaveBeenCalled();
  });

  it('persistTodayHubRowToVault records last persisted markdown after a successful save', async () => {
    const rowUri = '/vault/Hub/Row.md';
    const norm = normalizeEditorDocUri(rowUri)!;
    const todayHubRowLastPersistedRef = ref(new Map<string, string>());
    const saveActiveRef = ref(false);
    const saveChainRef = ref(Promise.resolve());
    await enqueuePersistTodayHubRowOnSaveChain(rowUri, '| hello |', 1, {
      ...makeDeps({
        vaultRootRef: ref('/vault'),
        todayHubRowLastPersistedRef,
      }),
      saveActiveRef,
      saveChainRef,
    });

    expect(vaultBootstrap.saveNoteMarkdown).toHaveBeenCalled();
    expect(todayHubRowLastPersistedRef.current.get(norm)).toBeDefined();
  });

  it('persistTodayHubRowToVault reports save failures via setErr', async () => {
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockRejectedValueOnce(new Error('disk'));
    const setErr = vi.fn();
    const saveActiveRef = ref(false);
    const saveChainRef = ref(Promise.resolve());
    await enqueuePersistTodayHubRowOnSaveChain('/vault/Hub/Row.md', '| hello |', 1, {
      ...makeDeps({vaultRootRef: ref('/vault'), setErr}),
      saveActiveRef,
      saveChainRef,
    });

    expect(setErr).toHaveBeenCalledWith('disk');
  });
});
