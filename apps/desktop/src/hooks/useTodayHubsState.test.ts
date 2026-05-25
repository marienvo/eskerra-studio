// @vitest-environment happy-dom
import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {createIdleTodayHubWorkspaceBridge} from '../lib/todayHub';
import * as vaultBootstrap from '../lib/vaultBootstrap';
import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {
  useTodayHubsState,
  type UseTodayHubsStateArgs,
} from './useTodayHubsState';

vi.mock('../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: vi.fn(async (md: string) => md),
}));

vi.mock('../lib/vaultBootstrap', () => ({
  saveNoteMarkdown: vi.fn().mockResolvedValue(undefined),
  deleteVaultMarkdownNote: vi.fn().mockResolvedValue(undefined),
}));

function ref<T>(current: T): {current: T} {
  return {current};
}

function makeArgs(
  overrides: Partial<UseTodayHubsStateArgs> = {},
): UseTodayHubsStateArgs {
  const fs = {
    exists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
  } as unknown as VaultFilesystem;
  const workspaceShadowModel: WorkspaceModel = {activeHub: null, workspaces: {}};
  const editorWorkspaceTabs: EditorWorkspaceTab[] = [];
  return {
    fs,
    vaultRoot: null,
    selectedUri: null,
    editorBody: '',
    composingNewEntry: false,
    inboxYamlFrontmatterInner: null,
    inboxEditorYamlLeadingBeforeFrontmatter: '',
    notes: [],
    vaultMarkdownRefs: [] as VaultMarkdownRef[],
    vaultMarkdownRefsReady: true,
    inboxShellRestored: false,
    workspaceShadowModel,
    dispatchWorkspaceActionSync: vi.fn((_, reduce) => reduce(workspaceShadowModel)),
    replaceShadowHomeStateForHub: vi.fn(),
    mirrorShadowActiveHub: vi.fn(),
    mirrorShadowHomeSurface: vi.fn(),
    mirrorShadowActiveTab: vi.fn(),
    mirrorShadowActiveWorkspaceTabs: vi.fn(),
    vaultRootRef: ref<string | null>(null),
    showTodayHubCanvasRef: ref(false),
    todayHubBridgeRef: ref(createIdleTodayHubWorkspaceBridge()),
    todayHubWikiNavParentRef: ref<string | null>(null),
    todayHubCellEditorRef: ref(null),
    todayHubRowLastPersistedRef: ref(new Map<string, string>()),
    todayHubSettingsRef: ref(null),
    vaultMarkdownRefsRef: ref([] as VaultMarkdownRef[]),
    selectedUriRef: ref<string | null>(null),
    composingNewEntryRef: ref(false),
    inboxYamlFrontmatterInnerRef: ref<string | null>(null),
    inboxEditorYamlLeadingBeforeFrontmatterRef: ref(''),
    editorWorkspaceTabs,
    activeEditorTabId: null,
    editorWorkspaceTabsRef: ref(editorWorkspaceTabs),
    activeEditorTabIdRef: ref<string | null>(null),
    replaceEditorWorkspaceTabs: vi.fn(),
    setEditorWorkspaceTabs: vi.fn(),
    setActiveEditorTabId: vi.fn(),
    setComposingNewEntry: vi.fn(),
    setInboxYamlFrontmatterInner: vi.fn(),
    setInboxEditorYamlLeadingBeforeFrontmatter: vi.fn(),
    setEditorBody: vi.fn(),
    setInboxEditorResetNonce: vi.fn(),
    flushInboxSaveRef: ref(vi.fn().mockResolvedValue(undefined)),
    saveChainRef: ref(Promise.resolve()),
    saveActiveRef: ref(false),
    inboxContentByUriRef: ref({}),
    setInboxContentByUri: vi.fn(),
    refreshNotes: vi.fn().mockResolvedValue(undefined),
    setFsRefreshNonce: vi.fn(),
    setErr: vi.fn(),
    markVaultWriteSettled: vi.fn(),
    subtreeMarkdownCache: new SubtreeMarkdownPresenceCache(),
    diskConflictRef: ref(null),
    openMarkdownInEditorRef: ref(vi.fn().mockResolvedValue(undefined)),
    activateOpenTabRef: ref(vi.fn()),
    selectNoteRef: ref(vi.fn()),
    ...overrides,
  };
}

describe('useTodayHubsState', () => {
  beforeEach(() => {
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockClear();
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockResolvedValue(undefined);
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockClear();
    vi.mocked(vaultBootstrap.deleteVaultMarkdownNote).mockResolvedValue(undefined);
  });

  it('owns Home history refs and mirrors changes to the workspace model bridge', () => {
    const replaceShadowHomeStateForHub = vi.fn();
    const {result} = renderHook(() =>
      useTodayHubsState(makeArgs({replaceShadowHomeStateForHub})),
    );

    act(() => {
      result.current.pushHomeHistoryForHub('/vault/Today.md', '/vault/Inbox/a.md');
    });

    expect(result.current.homeStatesByHubRef.current['/vault/Today.md']).toEqual({
      history: {
        entries: ['/vault/Today.md', '/vault/Inbox/a.md'],
        index: 1,
      },
    });
    expect(replaceShadowHomeStateForHub).toHaveBeenCalledWith(
      '/vault/Today.md',
      {
        history: {
          entries: ['/vault/Today.md', '/vault/Inbox/a.md'],
          index: 1,
        },
      },
      'homeHistory set',
    );
  });

  it('blocks Today row cleanup for the active disk conflict URI', () => {
    const diskConflictRef = ref({
      uri: '/vault\\Inbox\\row.md',
      diskMarkdown: '# disk',
    });
    const {result} = renderHook(() =>
      useTodayHubsState(makeArgs({diskConflictRef})),
    );

    expect(result.current.todayHubCleanRowBlocked('/vault/Inbox/row.md')).toBe(true);
    expect(result.current.todayHubCleanRowBlocked('/vault/Inbox/other.md')).toBe(false);
  });

  it('waits for vault markdown refs before syncing hub workspaces to vault refs', () => {
    const workspaceShadowModel: WorkspaceModel = {activeHub: null, workspaces: {}};
    const dispatch = vi.fn((_: string, reduce) => reduce(workspaceShadowModel));
    const hubRefs: VaultMarkdownRef[] = [{name: 'Today', uri: '/vault/Daily/Today.md'}];
    const vaultMarkdownRefsRef = ref(hubRefs);

    const {rerender} = renderHook(
      ({refsReady}: {refsReady: boolean}) =>
        useTodayHubsState(
          makeArgs({
            dispatchWorkspaceActionSync: dispatch,
            workspaceShadowModel,
            vaultRoot: '/vault',
            vaultRootRef: ref('/vault'),
            inboxShellRestored: true,
            vaultMarkdownRefsReady: refsReady,
            vaultMarkdownRefs: hubRefs,
            vaultMarkdownRefsRef,
          }),
        ),
      {initialProps: {refsReady: false}},
    );

    const syncCalls = () =>
      dispatch.mock.calls.filter(
        ([reason]) => reason === 'sync today hub workspaces to vault refs',
      );

    expect(syncCalls()).toHaveLength(0);
    rerender({refsReady: true});
    expect(syncCalls()).toHaveLength(1);
  });

  it('prehydrateTodayHubRows is a no-op when vaultRootRef is null', async () => {
    const exists = vi.fn();
    const readFile = vi.fn();
    const fs = {exists, readFile} as unknown as VaultFilesystem;
    const {result} = renderHook(() =>
      useTodayHubsState(makeArgs({fs, vaultRootRef: ref<string | null>(null)})),
    );

    await act(async () => {
      await result.current.prehydrateTodayHubRows(['/vault/x.md']);
    });

    expect(exists).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('prehydrateTodayHubRows skips URIs already present in the inbox body cache', async () => {
    const rowUri = '/vault/Today.md';
    const norm = normalizeEditorDocUri(rowUri)!;
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('# disk'),
    } as unknown as VaultFilesystem;
    const inboxContentByUriRef = ref({[norm]: '# cached'});
    const todayHubRowLastPersistedRef = ref(new Map<string, string>());
    const {result} = renderHook(() =>
      useTodayHubsState(
        makeArgs({
          fs,
          vaultRootRef: ref('/vault'),
          inboxContentByUriRef,
          todayHubRowLastPersistedRef,
        }),
      ),
    );

    await act(async () => {
      await result.current.prehydrateTodayHubRows([rowUri]);
    });

    expect(fs.exists).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(todayHubRowLastPersistedRef.current.has(norm)).toBe(false);
  });

  it('prehydrateTodayHubRows skips missing row files', async () => {
    const fs = {
      exists: vi.fn().mockResolvedValue(false),
      readFile: vi.fn(),
    } as unknown as VaultFilesystem;
    const setInboxContentByUri = vi.fn();
    const {result} = renderHook(() =>
      useTodayHubsState(
        makeArgs({fs, vaultRootRef: ref('/vault'), setInboxContentByUri}),
      ),
    );

    await act(async () => {
      await result.current.prehydrateTodayHubRows(['/vault/Missing.md']);
    });

    expect(fs.exists).toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(setInboxContentByUri).not.toHaveBeenCalled();
  });

  it('prehydrateTodayHubRows reads disk into the inbox cache and last-persisted map', async () => {
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
    const {result} = renderHook(() =>
      useTodayHubsState(
        makeArgs({
          fs,
          vaultRootRef: ref('/vault'),
          inboxContentByUriRef,
          todayHubRowLastPersistedRef,
          setInboxContentByUri,
        }),
      ),
    );

    await act(async () => {
      await result.current.prehydrateTodayHubRows([rowUri]);
    });

    const cached = inboxContentByUriRef.current[norm];
    expect(cached).toBeDefined();
    expect(todayHubRowLastPersistedRef.current.get(norm)).toBe(cached);
    expect(setInboxContentByUri).toHaveBeenCalled();
  });

  it('persistTodayHubRow records last persisted markdown after a successful save', async () => {
    const rowUri = '/vault/Hub/Row.md';
    const norm = normalizeEditorDocUri(rowUri)!;
    const todayHubRowLastPersistedRef = ref(new Map<string, string>());
    const {result} = renderHook(() =>
      useTodayHubsState(
        makeArgs({
          vaultRootRef: ref('/vault'),
          todayHubRowLastPersistedRef,
        }),
      ),
    );

    await act(async () => {
      await result.current.persistTodayHubRow(rowUri, '| hello |', 1);
    });

    expect(vaultBootstrap.saveNoteMarkdown).toHaveBeenCalled();
    expect(todayHubRowLastPersistedRef.current.get(norm)).toBeDefined();
  });

  it('persistTodayHubRow reports save failures via setErr', async () => {
    vi.mocked(vaultBootstrap.saveNoteMarkdown).mockRejectedValueOnce(new Error('disk'));
    const setErr = vi.fn();
    const {result} = renderHook(() =>
      useTodayHubsState(makeArgs({vaultRootRef: ref('/vault'), setErr})),
    );

    await act(async () => {
      await result.current.persistTodayHubRow('/vault/Hub/Row.md', '| hello |', 1);
    });

    expect(setErr).toHaveBeenCalledWith('disk');
  });

  it('switchTodayHubWorkspace flushes inbox save and dispatches hub switch', async () => {
    const HUB_A = '/vault/A/Today.md';
    const HUB_B = '/vault/B/Today.md';
    const a = normalizeWorkspaceUri(HUB_A);
    const b = normalizeWorkspaceUri(HUB_B);
    const workspaceShadowModel: WorkspaceModel = {
      activeHub: a,
      workspaces: {
        [a]: createDefaultWorkspaceState(HUB_A),
        [b]: createDefaultWorkspaceState(HUB_B),
      },
    };
    const dispatch = vi.fn((_: string, reduce) => reduce(workspaceShadowModel));
    const flushInboxSave = vi.fn().mockResolvedValue(undefined);
    const hubRefs: VaultMarkdownRef[] = [
      {name: 'Today', uri: HUB_A},
      {name: 'Today', uri: HUB_B},
    ];
    const vaultMarkdownRefsRef = ref(hubRefs);

    const {result} = renderHook(() =>
      useTodayHubsState(
        makeArgs({
          dispatchWorkspaceActionSync: dispatch,
          workspaceShadowModel,
          vaultRoot: '/vault',
          vaultRootRef: ref('/vault'),
          inboxShellRestored: true,
          vaultMarkdownRefs: hubRefs,
          vaultMarkdownRefsRef,
          flushInboxSaveRef: ref(flushInboxSave),
          openMarkdownInEditorRef: ref(vi.fn().mockResolvedValue(undefined)),
        }),
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });

    dispatch.mockClear();

    await act(async () => {
      await result.current.switchTodayHubWorkspace(HUB_B);
    });

    expect(flushInboxSave).toHaveBeenCalled();
    expect(
      dispatch.mock.calls.some(([reason]) => reason === 'today hub switch'),
    ).toBe(true);
  });

  it('openWorkspaceHomeCurrentInBackgroundTab opens hub Today, not home history cursor', async () => {
    const HUB = '/vault/Daily/Today.md';
    const SUB = '/vault/Daily/Note.md';
    const openMarkdownInEditor = vi.fn().mockResolvedValue(undefined);
    const {result} = renderHook(() =>
      useTodayHubsState(
        makeArgs({
          vaultRoot: '/vault',
          vaultRootRef: ref('/vault'),
          openMarkdownInEditorRef: ref(openMarkdownInEditor),
        }),
      ),
    );

    act(() => {
      result.current.setActiveTodayHubUri(HUB);
      result.current.pushHomeHistoryForHub(HUB, SUB);
    });

    await act(async () => {
      result.current.openWorkspaceHomeCurrentInBackgroundTab();
    });

    expect(openMarkdownInEditor).toHaveBeenCalledWith(
      HUB,
      expect.objectContaining({
        newTab: true,
        activateNewTab: false,
        insertAfterActive: true,
      }),
    );
    expect(openMarkdownInEditor).not.toHaveBeenCalledWith(
      SUB,
      expect.anything(),
    );
  });
});
