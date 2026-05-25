import {describe, expect, it, vi} from 'vitest';

import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  removeUrisAction,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {workspaceHomeStatesFromWorkspaceModel} from './workspaceRuntimeProjection';
import {
  applyExternalOpenNoteDeletedForFsWatch,
  reconcileOpenNotesAfterFsChangeFromVaultWatch,
  type ReconcileFsOpenMarkdownEnv,
  type ReconcileFsTodayHubEnv,
} from './workspaceFsWatchReconcile';

const HUB = '/vault/A/Today.md';
const NOTE = '/vault/Inbox/Deleted.md';
const OTHER = '/vault/Inbox/Other.md';
const PAGE = '/vault/Inbox/Page.md';
const RENAMED_TAB = '/vault/Inbox/Renamed.md';

function minimalEnv(
  overrides: Partial<ReconcileFsOpenMarkdownEnv> &
    Pick<
      ReconcileFsOpenMarkdownEnv,
      | 'editorWorkspaceTabsRef'
      | 'activeEditorTabIdRef'
      | 'selectedUriRef'
      | 'syncWorkspaceModelRemoveOpenTabUri'
    >,
): ReconcileFsOpenMarkdownEnv {
  return {
    cancelled: () => false,
    fs: {} as ReconcileFsOpenMarkdownEnv['fs'],
    vaultRootRef: {current: '/vault'},
    composingNewEntryRef: {current: false},
    diskConflictRef: {current: null},
    diskConflictSoftRef: {current: null},
    inboxContentByUriRef: {current: {}},
    lastPersistedRef: {current: null},
    editorBodyRef: {current: ''},
    openTimeDiskBodyRef: {current: ''},
    inboxYamlFrontmatterInnerRef: {current: null},
    inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
    editorShellScrollByUriRef: {current: new Map()},
    skipRecencyDeferForUriRef: {current: new Set()},
    diskConflictDeferTimerRef: {current: null},
    lastInboxEditorActivityAtRef: {current: 0},
    inboxEditorRef: {current: null},
    autosaveSchedulerRef: {
      current: {schedule: vi.fn(), cancel: vi.fn()},
    },
    writeLastPersistedSnapshotWithoutSeqBump: vi.fn(),
    bumpLastPersistedExternalMutationSeq: vi.fn(),
    setEditorWorkspaceTabs: vi.fn(),
    setActiveEditorTabId: vi.fn(),
    setDiskConflict: vi.fn(),
    setDiskConflictSoft: vi.fn(),
    setInboxContentByUri: vi.fn(),
    setSelectedUri: vi.fn(),
    setComposingNewEntry: vi.fn(),
    setEditorBody: vi.fn(),
    setInboxEditorResetNonce: vi.fn(),
    setInboxYamlFrontmatterInner: vi.fn(),
    setInboxEditorYamlLeadingBeforeFrontmatter: vi.fn(),
    openMarkdownInEditor: vi.fn(),
    loadFullMarkdownIntoInboxEditor: vi.fn(),
    scheduleBacklinksDeferOneFrameAfterLoad: vi.fn(),
    ...overrides,
  };
}

describe('applyExternalOpenNoteDeletedForFsWatch', () => {
  /**
   * Production `syncWorkspaceModelRemoveOpenTabUri` dispatches `removeUrisAction` on the shadow
   * model; the layout effect in `useMainWindowWorkspace` mirrors per-hub home history back to
   * legacy state via `workspaceHomeStatesFromWorkspaceModel`. The "mirrors production sync" test
   * below derives `homeStates` from the post-action model to match that flow.
   */
  it('calls syncWorkspaceModelRemoveOpenTabUri after legacy tab strip updates', async () => {
    const sync = vi.fn();
    const tab = {id: 't1', history: {entries: [NOTE], index: 0}};
    const env = minimalEnv({
      editorWorkspaceTabsRef: {current: [tab]},
      activeEditorTabIdRef: {current: 't1'},
      selectedUriRef: {current: OTHER},
      syncWorkspaceModelRemoveOpenTabUri: sync,
    });

    await applyExternalOpenNoteDeletedForFsWatch(env, NOTE);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(NOTE);
    expect(env.editorWorkspaceTabsRef.current).toEqual([]);
    expect(env.activeEditorTabIdRef.current).toBeNull();
  });

  it('sync callback matches removeUrisAction pruning for the deleted URI', async () => {
    const hubNorm = normalizeWorkspaceUri(HUB);
    let model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB),
          tabs: [{id: 't1', history: {entries: [NOTE, OTHER], index: 0}}],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    const sync = (uri: string) => {
      model = removeUrisAction(model, u => u === normalizeWorkspaceUri(uri));
    };

    const tab = {id: 't1', history: {entries: [NOTE, OTHER], index: 0}};
    const env = minimalEnv({
      editorWorkspaceTabsRef: {current: [tab]},
      activeEditorTabIdRef: {current: 't1'},
      selectedUriRef: {current: OTHER},
      syncWorkspaceModelRemoveOpenTabUri: sync,
    });

    await applyExternalOpenNoteDeletedForFsWatch(env, NOTE);

    const ws = model.workspaces[hubNorm];
    expect(ws?.tabs).toHaveLength(1);
    expect(ws?.tabs[0]?.history.entries).toEqual([OTHER]);
  });

  it('mirrors production sync: prune runtime home stacks and shadow tabs for the deleted URI', async () => {
    const hubNorm = normalizeWorkspaceUri(HUB);
    let model: WorkspaceModel = {
      activeHub: hubNorm,
      workspaces: {
        [hubNorm]: {
          ...createDefaultWorkspaceState(HUB),
          homeHistory: {entries: [hubNorm, NOTE, OTHER], index: 2},
          tabs: [{id: 't1', history: {entries: [NOTE, OTHER], index: 0}}],
          active: {kind: 'tab', id: 't1'},
        },
      },
    };
    let homeStates = workspaceHomeStatesFromWorkspaceModel(model);
    const sync = (uri: string) => {
      const target = normalizeWorkspaceUri(uri);
      model = removeUrisAction(model, u => u === target);
      homeStates = workspaceHomeStatesFromWorkspaceModel(model);
    };

    const tab = {id: 't1', history: {entries: [NOTE, OTHER], index: 0}};
    const env = minimalEnv({
      editorWorkspaceTabsRef: {current: [tab]},
      activeEditorTabIdRef: {current: 't1'},
      selectedUriRef: {current: OTHER},
      syncWorkspaceModelRemoveOpenTabUri: sync,
    });

    await applyExternalOpenNoteDeletedForFsWatch(env, NOTE);

    expect(homeStates[hubNorm]?.history.entries).toEqual([hubNorm, OTHER]);
    const ws = model.workspaces[hubNorm];
    expect(ws?.tabs).toHaveLength(1);
    expect(ws?.tabs[0]?.history.entries).toEqual([OTHER]);
  });
});

describe('reconcileOpenNotesAfterFsChangeFromVaultWatch — open-note padding', () => {
  function minimalTodayEnv(): ReconcileFsTodayHubEnv {
    return {
      todayHubRowLastPersistedRef: {current: new Map()},
      todayHubSettingsRef: {current: null},
      todayHubBridgeRef: {
        current: {
          getLiveRowUri: () => null,
          hasPendingHubFlush: () => false,
          flushPendingEdits: vi.fn(),
        },
      },
    };
  }

  it('reloads from disk instead of conflict when editor only has buffer-only padding', async () => {
    const diskBody = '# Title\nedited on disk';
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue(`${diskBody}\n`),
    } as unknown as ReconcileFsOpenMarkdownEnv['fs'];

    const setDiskConflict = vi.fn();
    const loadFullMarkdownIntoInboxEditor = vi.fn();
    const tab = {id: 't1', history: {entries: [NOTE], index: 0}};

    const env = minimalEnv({
      editorWorkspaceTabsRef: {current: [tab]},
      activeEditorTabIdRef: {current: 't1'},
      selectedUriRef: {current: NOTE},
      syncWorkspaceModelRemoveOpenTabUri: vi.fn(),
      fs,
      vaultRootRef: {current: '/vault'},
      lastPersistedRef: {current: {uri: NOTE, markdown: '# Title'}},
      editorBodyRef: {current: '# Title\n\n'},
      openTimeDiskBodyRef: {current: '# Title'},
      inboxEditorRef: {current: {getMarkdown: () => '# Title\n\n'} as never},
      loadFullMarkdownIntoInboxEditor,
      setDiskConflict,
    });

    await reconcileOpenNotesAfterFsChangeFromVaultWatch(
      env,
      minimalTodayEnv(),
      [NOTE],
      vi.fn(),
    );

    expect(setDiskConflict).not.toHaveBeenCalled();
    expect(loadFullMarkdownIntoInboxEditor).toHaveBeenCalledWith(diskBody, NOTE, 'preserve');
  });
});

describe('reconcileOpenNotesAfterFsChangeFromVaultWatch — home-navigated page', () => {
  function minimalTodayEnv(): ReconcileFsTodayHubEnv {
    return {
      todayHubRowLastPersistedRef: {current: new Map()},
      todayHubSettingsRef: {current: null},
      todayHubBridgeRef: {current: {getLiveRowUri: () => null, hasPendingHubFlush: () => false, flushPendingEdits: vi.fn()}},
    };
  }

  it('reconciles the home-navigated page URI when no tab is active', async () => {
    // Scenario: active surface is home (no active editor tab); user navigated to PAGE.
    // A wiki-link rename rewrote PAGE.md on disk. The tab strip only contains RENAMED_TAB.
    // PAGE is not in any tab, so it was previously missed by the reconcile loop.
    // normalizeVaultMarkdownDiskRead strips trailing newline, so the editor receives this form.
    const rewrittenDiskBody = '# Page\n[[Renamed]]';
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue(rewrittenDiskBody + '\n'),
    } as unknown as ReconcileFsOpenMarkdownEnv['fs'];

    const loadFullMarkdownIntoInboxEditor = vi.fn();

    const env = minimalEnv({
      editorWorkspaceTabsRef: {
        current: [{id: 't1', history: {entries: [RENAMED_TAB], index: 0}}],
      },
      // No active tab — home surface is active.
      activeEditorTabIdRef: {current: null},
      selectedUriRef: {current: PAGE},
      syncWorkspaceModelRemoveOpenTabUri: vi.fn(),
      fs,
      vaultRootRef: {current: '/vault'},
      loadFullMarkdownIntoInboxEditor,
      // lastPersistedRef is null (no known base) → classifyNoteDiskReconcile returns reload_from_disk
      // when disk differs from local. This matches the case where the rename maintenance writes the
      // page's file externally and lastPersisted hasn't been updated for the home-navigated URI.
      lastPersistedRef: {current: null},
      inboxContentByUriRef: {current: {}},
    });

    await reconcileOpenNotesAfterFsChangeFromVaultWatch(
      env,
      minimalTodayEnv(),
      [PAGE],
      vi.fn(),
    );

    expect(loadFullMarkdownIntoInboxEditor).toHaveBeenCalledWith(
      rewrittenDiskBody,
      PAGE,
      'preserve',
    );
  });

  it('does not reconcile the home-navigated URI when an editor tab is active', async () => {
    // Active surface is a tab — home page URI must not be double-reconciled.
    const loadFullMarkdownIntoInboxEditor = vi.fn();
    const fs = {
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue('new'),
    } as unknown as ReconcileFsOpenMarkdownEnv['fs'];

    const env = minimalEnv({
      editorWorkspaceTabsRef: {
        current: [{id: 't1', history: {entries: [RENAMED_TAB], index: 0}}],
      },
      // Active tab — home surface is NOT active.
      activeEditorTabIdRef: {current: 't1'},
      selectedUriRef: {current: PAGE},
      syncWorkspaceModelRemoveOpenTabUri: vi.fn(),
      fs,
      vaultRootRef: {current: '/vault'},
      loadFullMarkdownIntoInboxEditor,
    });

    await reconcileOpenNotesAfterFsChangeFromVaultWatch(
      env,
      minimalTodayEnv(),
      [PAGE],
      vi.fn(),
    );

    // PAGE is not in the tab strip and activeEditorTabId is set, so home-page path is skipped.
    expect(loadFullMarkdownIntoInboxEditor).not.toHaveBeenCalledWith(
      expect.anything(),
      PAGE,
      expect.anything(),
    );
  });
});
