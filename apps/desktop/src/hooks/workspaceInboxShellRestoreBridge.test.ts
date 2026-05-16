import {describe, expect, it, vi} from 'vitest';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {
  applyRestoredEditorWorkspaceTabsBridge,
  migrateLegacyOpenTabsIfNeededBridge,
  restoreInboxSelectionAfterShellRestoreBridge,
  runDeferredShellRestoreTabStateAndShadowSync,
} from './workspaceInboxShellRestoreBridge';

const HUB = '/vault/A/Today.md';
const NOTE = '/vault/Inbox/N.md';

describe('applyRestoredEditorWorkspaceTabsBridge', () => {
  it('updates refs synchronously without scheduling deferred UI', () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {current: []};
    const activeRef: {current: string | null} = {current: null};
    const schedule = vi.fn();
    vi.stubGlobal('queueMicrotask', schedule);

    const uris = applyRestoredEditorWorkspaceTabsBridge(
      {editorWorkspaceTabsRef: tabsRef, activeEditorTabIdRef: activeRef},
      [{id: 't1', entries: [NOTE], index: 0}],
      't1',
      () => true,
    );

    expect(schedule).not.toHaveBeenCalled();
    expect(tabsRef.current.map(t => t.id)).toEqual(['t1']);
    expect(activeRef.current).toBe('t1');
    expect(uris).toEqual([NOTE]);
    vi.unstubAllGlobals();
  });
});

describe('migrateLegacyOpenTabsIfNeededBridge', () => {
  it('updates refs synchronously without scheduling deferred UI', () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {current: []};
    const activeRef: {current: string | null} = {current: null};
    const schedule = vi.fn();
    vi.stubGlobal('queueMicrotask', schedule);

    const uris = migrateLegacyOpenTabsIfNeededBridge(
      {editorWorkspaceTabsRef: tabsRef, activeEditorTabIdRef: activeRef},
      [NOTE],
      () => true,
    );

    expect(schedule).not.toHaveBeenCalled();
    expect(tabsRef.current).toHaveLength(1);
    expect(activeRef.current).toBe(tabsRef.current[0]!.id);
    expect(uris).toEqual([NOTE]);
    vi.unstubAllGlobals();
  });
});

describe('runDeferredShellRestoreTabStateAndShadowSync', () => {
  it('uses sync projection and skips tab mirrors when payload + sync callback are present', async () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {
      current: [{id: 't1', history: {entries: [NOTE], index: 0}}],
    };
    const activeRef: {current: string | null} = {current: 't1'};
    const setTabs = vi.fn();
    const setActive = vi.fn();
    const mirrorTabs = vi.fn();
    const mirrorTab = vi.fn();
    const mirrorHome = vi.fn();
    const sync = vi.fn();

    const merged: Record<string, TodayHubWorkspaceSnapshot> = {
      [HUB]: {
        editorWorkspaceTabs: [{id: 't1', entries: [NOTE], index: 0}],
        activeEditorTabId: 't1',
      },
    };
    const homeByHub: Record<string, WorkspaceHomeState> = {
      [HUB]: {history: {entries: [HUB], index: 0}},
    };

    runDeferredShellRestoreTabStateAndShadowSync(
      {
        editorWorkspaceTabsRef: tabsRef,
        activeEditorTabIdRef: activeRef,
        setEditorWorkspaceTabs: setTabs,
        setActiveEditorTabId: setActive,
        mirrorShadowActiveWorkspaceTabs: mirrorTabs,
        mirrorShadowActiveTab: mirrorTab,
        mirrorShadowHomeSurface: mirrorHome,
        syncShadowWorkspaceFromShellRestore: sync,
      },
      {
        activeTodayHubUri: HUB,
        hubUris: [HUB],
        todayHubWorkspaces: merged,
        homeStatesByHub: homeByHub,
      },
    );

    await Promise.resolve();

    expect(setTabs).toHaveBeenCalledWith(tabsRef.current);
    expect(setActive).toHaveBeenCalledWith('t1');
    expect(sync).toHaveBeenCalledWith({
      activeTodayHubUri: HUB,
      hubUris: [HUB],
      todayHubWorkspaces: merged,
      homeStatesByHub: homeByHub,
    });
    expect(mirrorTabs).not.toHaveBeenCalled();
    expect(mirrorTab).not.toHaveBeenCalled();
    expect(mirrorHome).not.toHaveBeenCalled();
  });

  it('falls back to mirrors when projection hub list is empty', async () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {
      current: [{id: 't1', history: {entries: [NOTE], index: 0}}],
    };
    const activeRef: {current: string | null} = {current: 't1'};
    const mirrorTabs = vi.fn();
    const mirrorTab = vi.fn();
    const mirrorHome = vi.fn();
    const sync = vi.fn();

    runDeferredShellRestoreTabStateAndShadowSync(
      {
        editorWorkspaceTabsRef: tabsRef,
        activeEditorTabIdRef: activeRef,
        setEditorWorkspaceTabs: vi.fn(),
        setActiveEditorTabId: vi.fn(),
        mirrorShadowActiveWorkspaceTabs: mirrorTabs,
        mirrorShadowActiveTab: mirrorTab,
        mirrorShadowHomeSurface: mirrorHome,
        syncShadowWorkspaceFromShellRestore: sync,
      },
      {
        activeTodayHubUri: null,
        hubUris: [],
        todayHubWorkspaces: {},
        homeStatesByHub: {},
      },
    );

    await Promise.resolve();

    expect(sync).not.toHaveBeenCalled();
    expect(mirrorTabs).toHaveBeenCalled();
    expect(mirrorTab).toHaveBeenCalledWith('t1', expect.any(String));
  });

  it('falls back to mirrors when sync callback is omitted', async () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {
      current: [],
    };
    const activeRef: {current: string | null} = {current: null};
    const mirrorTabs = vi.fn();
    const mirrorHome = vi.fn();

    runDeferredShellRestoreTabStateAndShadowSync(
      {
        editorWorkspaceTabsRef: tabsRef,
        activeEditorTabIdRef: activeRef,
        setEditorWorkspaceTabs: vi.fn(),
        setActiveEditorTabId: vi.fn(),
        mirrorShadowActiveWorkspaceTabs: mirrorTabs,
        mirrorShadowActiveTab: vi.fn(),
        mirrorShadowHomeSurface: mirrorHome,
      },
      {
        activeTodayHubUri: HUB,
        hubUris: [HUB],
        todayHubWorkspaces: {},
        homeStatesByHub: {[HUB]: {history: {entries: [HUB], index: 0}}},
      },
    );

    await Promise.resolve();

    expect(mirrorTabs).toHaveBeenCalled();
    expect(mirrorHome).toHaveBeenCalled();
  });
});

describe('restoreInboxSelectionAfterShellRestoreBridge', () => {
  it('uses selectHomeCurrentNote when the restored surface is Home (no active tab)', () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {
      current: [{id: 't1', history: {entries: [NOTE], index: 0}}],
    };
    const activeTabRef: {current: string | null} = {current: null};
    const hubRef: {current: string | null} = {current: HUB};
    const selectNote = vi.fn();
    const selectHomeCurrentNote = vi.fn();

    restoreInboxSelectionAfterShellRestoreBridge(
      {
        editorWorkspaceTabsRef: tabsRef,
        activeEditorTabIdRef: activeTabRef,
        activeTodayHubUriRef: hubRef,
        notesRef: {current: [{uri: NOTE}]},
        getRestoredInboxState: () => ({
          vaultRoot: '/vault',
          composingNewEntry: false,
          selectedUri: NOTE,
          activeTodayHubUri: HUB,
        }),
        startNewEntry: vi.fn(),
        selectNote,
        selectHomeCurrentNote,
      },
      '/vault',
      [NOTE],
      1,
    );

    expect(selectHomeCurrentNote).toHaveBeenCalledWith(HUB);
    expect(selectNote).not.toHaveBeenCalled();
  });

  it('uses selectNote when the restored surface is an active tab', () => {
    const tabsRef: {current: EditorWorkspaceTab[]} = {
      current: [{id: 't1', history: {entries: [NOTE], index: 0}}],
    };
    const activeTabRef: {current: string | null} = {current: 't1'};
    const hubRef: {current: string | null} = {current: HUB};
    const selectNote = vi.fn();
    const selectHomeCurrentNote = vi.fn();

    restoreInboxSelectionAfterShellRestoreBridge(
      {
        editorWorkspaceTabsRef: tabsRef,
        activeEditorTabIdRef: activeTabRef,
        activeTodayHubUriRef: hubRef,
        notesRef: {current: [{uri: NOTE}]},
        getRestoredInboxState: () => ({
          vaultRoot: '/vault',
          composingNewEntry: false,
          selectedUri: NOTE,
          activeTodayHubUri: HUB,
        }),
        startNewEntry: vi.fn(),
        selectNote,
        selectHomeCurrentNote,
      },
      '/vault',
      [NOTE],
      1,
    );

    expect(selectNote).toHaveBeenCalledWith(NOTE);
    expect(selectHomeCurrentNote).not.toHaveBeenCalled();
  });
});
