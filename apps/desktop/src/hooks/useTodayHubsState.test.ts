import {act, renderHook} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {
  SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {createIdleTodayHubWorkspaceBridge} from '../lib/todayHub';
import type {WorkspaceModel} from '../lib/workspaceModel';
import {
  useTodayHubsState,
  type UseTodayHubsStateArgs,
} from './useTodayHubsState';

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
});
