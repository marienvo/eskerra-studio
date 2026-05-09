import {describe, expect, it, vi} from 'vitest';

import {
  createDefaultWorkspaceState,
  normalizeWorkspaceUri,
  removeUrisAction,
  type WorkspaceModel,
} from '../lib/workspaceModel';
import {computePrunedHomeStatesAfterUriRemoval} from './workspaceHomeHistoryShadowSync';
import {
  applyExternalOpenNoteDeletedForFsWatch,
  type ReconcileFsOpenMarkdownEnv,
} from './workspaceFsWatchReconcile';

const HUB = '/vault/A/Today.md';
const NOTE = '/vault/Inbox/Deleted.md';
const OTHER = '/vault/Inbox/Other.md';

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
    markLastPersistedMutation: vi.fn(),
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
   * Production `syncWorkspaceModelRemoveOpenTabUri` mirrors `removeHomeHistoryUris`: it calls
   * `removeHomeHistoryUrisBridge` then `removeUrisAction` on the shadow model. Mocks below only
   * implement the shadow side unless a test explicitly simulates both.
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
    let homeStates: Record<string, {history: {entries: string[]; index: number}}> = {
      [hubNorm]: {
        history: {entries: [hubNorm, NOTE, OTHER], index: 2},
      },
    };
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
      const target = normalizeWorkspaceUri(uri);
      const {next} = computePrunedHomeStatesAfterUriRemoval({
        current: homeStates,
        shouldRemove: u => u === target,
      });
      homeStates = next;
      model = removeUrisAction(model, u => u === target);
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
