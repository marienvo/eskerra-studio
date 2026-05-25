import {vi} from 'vitest';

import {
  SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {EditorWorkspaceTab} from '../../lib/editorWorkspaceTabs';
import {createIdleTodayHubWorkspaceBridge} from '../../lib/todayHub';
import type {WorkspaceModel} from '../../lib/workspaceModel';
import type {UseTodayHubsStateArgs} from './useTodayHubsStateTypes';

export function ref<T>(current: T): {current: T} {
  return {current};
}

export function makeTodayHubsStateArgs(
  overrides: Partial<UseTodayHubsStateArgs> = {},
): UseTodayHubsStateArgs {
  const fs = {
    exists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
  } as unknown as VaultFilesystem;
  const workspaceShadowModel: WorkspaceModel = {activeHub: null, workspaces: {}};
  const editorWorkspaceTabs: EditorWorkspaceTab[] = [];
  const base: UseTodayHubsStateArgs = {
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
    workspace: {
      workspaceShadowModel,
      dispatchWorkspaceActionSync: vi.fn((_, reduce) => reduce(workspaceShadowModel)),
      mirror: {
        replaceShadowHomeStateForHub: vi.fn(),
        mirrorShadowActiveHub: vi.fn(),
        mirrorShadowHomeSurface: vi.fn(),
        mirrorShadowActiveTab: vi.fn(),
        mirrorShadowActiveWorkspaceTabs: vi.fn(),
      },
    },
    editorTabs: {
      editorWorkspaceTabs,
      activeEditorTabId: null,
      replaceEditorWorkspaceTabs: vi.fn(),
      setEditorWorkspaceTabs: vi.fn(),
      setActiveEditorTabId: vi.fn(),
      setComposingNewEntry: vi.fn(),
      setInboxYamlFrontmatterInner: vi.fn(),
      setInboxEditorYamlLeadingBeforeFrontmatter: vi.fn(),
      setEditorBody: vi.fn(),
      setInboxEditorResetNonce: vi.fn(),
      setInboxContentByUri: vi.fn(),
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
      editorWorkspaceTabsRef: ref(editorWorkspaceTabs),
      activeEditorTabIdRef: ref<string | null>(null),
      flushInboxSaveRef: ref(vi.fn().mockResolvedValue(undefined)),
      saveChainRef: ref(Promise.resolve()),
      saveActiveRef: ref(false),
      inboxContentByUriRef: ref({}),
      diskConflictRef: ref(null),
      openMarkdownInEditorRef: ref(vi.fn().mockResolvedValue(undefined)),
      activateOpenTabRef: ref(vi.fn()),
      selectNoteRef: ref(vi.fn()),
    },
    refreshNotes: vi.fn().mockResolvedValue(undefined),
    setFsRefreshNonce: vi.fn(),
    setErr: vi.fn(),
    markVaultWriteSettled: vi.fn(),
    subtreeMarkdownCache: new SubtreeMarkdownPresenceCache(),
  };
  return {
    ...base,
    ...overrides,
    workspace: {...base.workspace, ...overrides.workspace, mirror: {...base.workspace.mirror, ...overrides.workspace?.mirror}},
    editorTabs: {...base.editorTabs, ...overrides.editorTabs},
  };
}
