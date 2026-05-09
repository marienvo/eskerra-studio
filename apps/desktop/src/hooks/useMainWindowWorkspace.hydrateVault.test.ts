import {act, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';

import {
  getDesktopMainWindowIntegrationMocks,
  mountHydratedMainWindowWorkspace,
} from './useMainWindowWorkspace.integration.harness';
import {decideHomeOpenMode} from './workspaceEditorTabs';

const VAULT_ROOT = '/vault';
const HUB_A = `${VAULT_ROOT}/A/Today.md`;
const HUB_B = `${VAULT_ROOT}/B/Today.md`;

describe('useMainWindowWorkspace + fake VaultFilesystem (hydrateVault)', () => {
  beforeEach(() => {
    getDesktopMainWindowIntegrationMocks().resetAll();
  });

  it('hydrateVault bootstraps the vault on the fake fs and wires session + watch', async () => {
    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault'],
    });
    const {tauriVaultMocks, eventMocks, vaultSearchMocks, vaultFrontmatterMocks, pluginStoreState} =
      getDesktopMainWindowIntegrationMocks();

    expect(result.current.busy).toBe(false);
    expect(result.current.notificationsState.err).toBeNull();
    expect(result.current.vaultSettings).not.toBeNull();
    expect(result.current.deviceInstanceId.length).toBeGreaterThan(0);

    expect(await fs.exists('/vault/Inbox')).toBe(true);
    expect(await fs.exists('/vault/General')).toBe(true);
    expect(await fs.exists('/vault/.eskerra/settings-shared.json')).toBe(true);
    expect(await fs.exists('/vault/.eskerra/settings-local.json')).toBe(true);

    expect(tauriVaultMocks.setVaultSession).toHaveBeenCalledWith('/vault');
    expect(tauriVaultMocks.startVaultWatch).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(eventMocks.listen).toHaveBeenCalledWith(
        'vault-files-changed',
        expect.any(Function),
      );
    });

    await waitFor(() => {
      expect(vaultSearchMocks.vaultSearchIndexSchedule).toHaveBeenCalled();
      expect(vaultFrontmatterMocks.vaultFrontmatterIndexSchedule).toHaveBeenCalled();
    });

    expect(pluginStoreState.store.set).toHaveBeenCalledWith('vaultRoot', '/vault');
    expect(pluginStoreState.store.save).toHaveBeenCalled();

    unmount();
  });

  it('restores active hub Home with zero tabs without materializing a Today tab', async () => {
    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`],
        files: {
          [HUB_A]: 'today\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(0);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.editorWorkspaceTabs,
      ).toEqual([]);
    });

    unmount();
  });

  it('drops restored echo tab whose current URI is the hub Today URI', async () => {
    const echoSnapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'echo-tab', entries: [HUB_A], index: 0}],
      activeEditorTabId: 'echo-tab',
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`],
        files: {
          [HUB_A]: 'today\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: echoSnapshot,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(0);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.editorWorkspaceTabs,
      ).toEqual([]);
    });

    unmount();
  });

  it('keeps persisted active hub workspace sanitized after dropping a restored echo tab', async () => {
    const echoSnapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'echo-tab', entries: [HUB_A], index: 0}],
      activeEditorTabId: 'echo-tab',
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`],
        files: {
          [HUB_A]: 'today\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: echoSnapshot.editorWorkspaceTabs,
          activeEditorTabId: echoSnapshot.activeEditorTabId,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: echoSnapshot,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A],
      ).toEqual(
        expect.objectContaining({
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          homeHistory: {entries: [HUB_A], index: 0},
        }),
      );
    });

    unmount();
  });

  it('preserves Home as active surface when restored hub snapshot has tabs but active tab is null', async () => {
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [
        {id: 'tab-a1', entries: [`${VAULT_ROOT}/Inbox/A.md`], index: 0},
      ],
      activeEditorTabId: null,
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [`${VAULT_ROOT}/Inbox/A.md`]: 'a\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: snapshotA.editorWorkspaceTabs,
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: snapshotA,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(result.current.tabsController.editorWorkspaceTabs.map(t => t.id)).toEqual([
        'tab-a1',
      ]);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
    });

    unmount();
  });

  it('restores another hub tabs when switching immediately after hydrate', async () => {
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [
        {id: 'tab-a1', entries: [`${VAULT_ROOT}/Inbox/A.md`], index: 0},
      ],
      activeEditorTabId: 'tab-a1',
    };
    const snapshotB: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [
        {id: 'tab-b1', entries: [`${VAULT_ROOT}/Inbox/B.md`], index: 0},
      ],
      activeEditorTabId: 'tab-b1',
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/B`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today a\n',
          [HUB_B]: 'today b\n',
          [`${VAULT_ROOT}/Inbox/A.md`]: 'a\n',
          [`${VAULT_ROOT}/Inbox/B.md`]: 'b\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: `${VAULT_ROOT}/Inbox/B.md`,
          editorWorkspaceTabs: snapshotB.editorWorkspaceTabs,
          activeEditorTabId: snapshotB.activeEditorTabId,
          activeTodayHubUri: HUB_B,
          todayHubWorkspaces: {
            [HUB_A]: snapshotA,
            [HUB_B]: snapshotB,
          },
        },
      },
    );

    await act(async () => {
      await result.current.todayHubController.switchTodayHubWorkspace(HUB_A);
    });

    await waitFor(() => {
      expect(result.current.todayHubController.activeTodayHubUri).toBe(HUB_A);
      expect(result.current.todayHubController.persistenceActiveTodayHubUri).toBe(HUB_A);
      expect(result.current.tabsController.activeEditorTabId).toBe('tab-a1');
      expect(result.current.tabsController.editorWorkspaceTabs.map(t => t.id)).toEqual([
        'tab-a1',
      ]);
      expect(result.current.workspaceShadowModelForTests?.activeHub).toBe(HUB_A);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: 'tab-a1',
      });
    });

    unmount();
  });

  it('persists inactive workspace tabs across restart and restores them after switching back', async () => {
    const NOTE_A1 = `${VAULT_ROOT}/Inbox/A1.md`;
    const NOTE_B1 = `${VAULT_ROOT}/Inbox/B1.md`;

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/B`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today a\n',
          [HUB_B]: 'today b\n',
          [NOTE_A1]: 'a1\n',
          [NOTE_B1]: 'b1\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
            [HUB_B]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    await act(async () => {
      result.current.selectionController.selectNoteInNewActiveTab(NOTE_A1);
    });

    await waitFor(() => {
      expect(result.current.tabsController.editorWorkspaceTabs.map(t => t.id)).toHaveLength(1);
      expect(result.current.tabsController.editorWorkspaceTabs[0]?.history.entries).toEqual([
        NOTE_A1,
      ]);
      const tabId = result.current.tabsController.activeEditorTabId;
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: tabId, history: {entries: [NOTE_A1], index: 0}},
      ]);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: tabId,
      });
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.editorWorkspaceTabs,
      ).toEqual([{id: tabId, entries: [NOTE_A1], index: 0}]);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.activeEditorTabId,
      ).toBe(tabId);
    });

    await act(async () => {
      await result.current.todayHubController.switchTodayHubWorkspace(HUB_B);
    });

    await waitFor(() => {
      expect(result.current.todayHubController.activeTodayHubUri).toBe(HUB_B);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.editorWorkspaceTabs[0]?.entries,
      ).toEqual([NOTE_A1]);
    });

    await act(async () => {
      result.current.selectionController.selectNoteInNewActiveTab(NOTE_B1);
    });

    await waitFor(() => {
      expect(result.current.tabsController.editorWorkspaceTabs[0]?.history.entries).toEqual([
        NOTE_B1,
      ]);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_B]
          ?.editorWorkspaceTabs[0]?.entries,
      ).toEqual([NOTE_B1]);
    });

    const persistedTodayHubWorkspaces = structuredClone(
      result.current.todayHubController.persistenceTodayHubWorkspaces,
    );
    expect(persistedTodayHubWorkspaces[HUB_A]?.editorWorkspaceTabs[0]?.entries).toEqual([
      NOTE_A1,
    ]);
    expect(persistedTodayHubWorkspaces[HUB_B]?.editorWorkspaceTabs[0]?.entries).toEqual([
      NOTE_B1,
    ]);

    unmount();

    const {result: restarted, unmount: unmountRestarted} =
      await mountHydratedMainWindowWorkspace(
        {
          dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/B`, `${VAULT_ROOT}/Inbox`],
          files: {
            [HUB_A]: 'today a\n',
            [HUB_B]: 'today b\n',
            [NOTE_A1]: 'a1\n',
            [NOTE_B1]: 'b1\n',
          },
        },
        {
          restoredInboxState: {
            vaultRoot: VAULT_ROOT,
            composingNewEntry: false,
            selectedUri: NOTE_B1,
            editorWorkspaceTabs: persistedTodayHubWorkspaces[HUB_B]?.editorWorkspaceTabs ?? [],
            activeEditorTabId: persistedTodayHubWorkspaces[HUB_B]?.activeEditorTabId ?? null,
            activeTodayHubUri: HUB_B,
            todayHubWorkspaces: persistedTodayHubWorkspaces,
          },
        },
      );

    await waitFor(() => {
      expect(restarted.current.inboxShellRestored).toBe(true);
      expect(restarted.current.selectionController.vaultMarkdownRefs.map(r => r.uri)).toEqual(
        expect.arrayContaining([HUB_A, HUB_B]),
      );
      expect(
        restarted.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.editorWorkspaceTabs[0]?.entries,
      ).toEqual([NOTE_A1]);
    });

    await act(async () => {
      await restarted.current.todayHubController.switchTodayHubWorkspace(HUB_A);
    });

    await waitFor(() => {
      expect(restarted.current.tabsController.editorWorkspaceTabs[0]?.history.entries).toEqual([
        NOTE_A1,
      ]);
      expect(restarted.current.selectionController.selectedUri).toBe(NOTE_A1);
      const tabId = restarted.current.tabsController.activeEditorTabId;
      expect(restarted.current.workspaceShadowModelForTests?.activeHub).toBe(HUB_A);
      expect(restarted.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: tabId, history: {entries: [NOTE_A1], index: 0}},
      ]);
      expect(restarted.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: tabId,
      });
    });

    unmountRestarted();
  });

  it('preserves edited inbox note content when switching away and back (disk + hook state after flush)', async () => {
    const uriA = '/vault/Inbox/Alpha.md';
    const uriB = '/vault/Inbox/Beta.md';
    const initialBody = 'alpha-seed';
    const editedBody = 'alpha-edited';

    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {
        [uriA]: `${initialBody}\n`,
        [uriB]: 'beta-seed\n',
      },
    });

    await waitFor(() => {
      expect(result.current.selectionController.notes.length).toBe(2);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(initialBody);
    });

    act(() => {
      result.current.selectionController.setEditorBody(editedBody);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(editedBody);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriB);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriB);
    });

    await waitFor(async () => {
      expect(await fs.readFile(uriA, {encoding: 'utf8'})).toBe(editedBody);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(editedBody);
    });

    await act(async () => {
      await result.current.persistenceController.flushInboxSave();
    });

    expect(await fs.readFile(uriA, {encoding: 'utf8'})).toBe(editedBody);
    expect(result.current.selectionController.inboxContentByUri[uriA]).toBe(editedBody);

    unmount();
  });

  it('navigates from workspace Home in-place and keeps tab state empty', async () => {
    const targetUri = '/vault/Inbox/Alpha.md';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/General', '/vault/Inbox'],
      files: {
        '/vault/General/Today.md': 'today\n',
        [targetUri]: 'alpha-seed\n',
      },
    });

    await waitFor(() => {
      expect(result.current.todayHubController.activeTodayHubUri).not.toBeNull();
    });
    const hubUri = result.current.todayHubController.activeTodayHubUri!;

    await act(async () => {
      result.current.todayHubController.focusActiveTodayHubNote();
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(hubUri);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(0);
    });

    await act(async () => {
      result.current.selectionController.selectNote(targetUri);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(targetUri);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(0);
      expect(result.current.tabsController.editorHistoryCanGoBack).toBe(true);
      expect(
        result.current.workspaceShadowModelForTests?.workspaces[hubUri]?.homeHistory,
      ).toEqual({
        entries: [hubUri, targetUri],
        index: 1,
      });
    });

    act(() => {
      result.current.tabsController.editorHistoryGoBack();
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(hubUri);
      expect(result.current.tabsController.editorHistoryCanGoForward).toBe(true);
      expect(
        result.current.workspaceShadowModelForTests?.workspaces[hubUri]?.homeHistory,
      ).toEqual({
        entries: [hubUri, targetUri],
        index: 0,
      });
    });

    act(() => {
      result.current.tabsController.editorHistoryGoForward();
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(targetUri);
      expect(
        result.current.workspaceShadowModelForTests?.workspaces[hubUri]?.homeHistory,
      ).toEqual({
        entries: [hubUri, targetUri],
        index: 1,
      });
    });

    unmount();
  });

  it('keeps active hub Today on Home when focused while Home is active', async () => {
    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`],
        files: {
          [HUB_A]: 'today\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
    });

    await act(async () => {
      result.current.todayHubController.focusActiveTodayHubNote();
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(0);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]
          ?.editorWorkspaceTabs,
      ).toEqual([]);
    });

    unmount();
  });

  it('same-hub workspace dropdown with an active tab activates Home at the current Home URI (no Home history push)', async () => {
    const TAB_NOTE = `${VAULT_ROOT}/Inbox/TabOnly.md`;
    const HOME_SUB = `${VAULT_ROOT}/Inbox/HomeSubPage.md`;
    const snapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 't1', entries: [TAB_NOTE], index: 0}],
      activeEditorTabId: 't1',
      homeHistory: {
        entries: [HUB_A, HOME_SUB],
        index: 1,
      },
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [TAB_NOTE]: 'tab\n',
          [HOME_SUB]: 'home sub\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: TAB_NOTE,
          editorWorkspaceTabs: snapshot.editorWorkspaceTabs,
          activeEditorTabId: 't1',
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: snapshot,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: 't1',
      });
    });

    await act(async () => {
      await result.current.todayHubController.switchTodayHubWorkspace(HUB_A);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(HOME_SUB);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory,
      ).toEqual({
        entries: [HUB_A, HOME_SUB],
        index: 1,
      });
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'home',
      });
    });

    await act(async () => {
      result.current.tabsController.activateOpenTab('t1');
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(TAB_NOTE);
      expect(result.current.tabsController.activeEditorTabId).toBe('t1');
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: 't1',
      });
    });

    unmount();
  });

  it('keeps shadow tab arrays aligned across tab navigation and list operations', async () => {
    const NOTE_1 = `${VAULT_ROOT}/Inbox/TabOne.md`;
    const NOTE_2 = `${VAULT_ROOT}/Inbox/TabTwo.md`;
    const NOTE_3 = `${VAULT_ROOT}/Inbox/TabThree.md`;
    const NOTE_3_RENAMED = `${VAULT_ROOT}/Inbox/TabThreeRenamed.md`;

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [NOTE_1]: 'one\n',
          [NOTE_2]: 'two\n',
          [NOTE_3]: 'three\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    await act(async () => {
      result.current.selectionController.selectNoteInNewActiveTab(NOTE_1);
    });
    await act(async () => {
      result.current.selectionController.selectNoteInNewActiveTab(NOTE_2);
    });

    let tabOneId = '';
    let tabTwoId = '';
    await waitFor(() => {
      const tabs = result.current.tabsController.editorWorkspaceTabs;
      expect(tabs.map(t => t.history.entries)).toEqual([[NOTE_1], [NOTE_2]]);
      tabOneId = tabs[0]!.id;
      tabTwoId = tabs[1]!.id;
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: tabOneId, history: {entries: [NOTE_1], index: 0}},
        {id: tabTwoId, history: {entries: [NOTE_2], index: 0}},
      ]);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: tabTwoId,
      });
    });

    await act(async () => {
      result.current.selectionController.selectNote(NOTE_3);
    });

    await waitFor(() => {
      expect(result.current.tabsController.editorWorkspaceTabs[1]?.history).toEqual({
        entries: [NOTE_2, NOTE_3],
        index: 1,
      });
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs[1]).toEqual({
        id: tabTwoId,
        history: {entries: [NOTE_2, NOTE_3], index: 1},
      });
    });

    await act(async () => {
      result.current.tabsController.editorHistoryGoBack();
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NOTE_2);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs[1]?.history).toEqual({
        entries: [NOTE_2, NOTE_3],
        index: 0,
      });
    });

    await act(async () => {
      result.current.tabsController.editorHistoryGoForward();
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NOTE_3);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs[1]?.history).toEqual({
        entries: [NOTE_2, NOTE_3],
        index: 1,
      });
    });

    await act(async () => {
      result.current.todayHubController.openWorkspaceHomeCurrentInBackgroundTab();
    });
    await waitFor(() => {
      expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(3);
      expect(result.current.tabsController.activeEditorTabId).toBe(tabTwoId);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toHaveLength(3);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: tabTwoId,
      });
    });

    await act(async () => {
      result.current.tabsController.reorderEditorWorkspaceTabs(2, 0);
    });
    await waitFor(() => {
      const runtimeOrder = result.current.tabsController.editorWorkspaceTabs.map(t => t.id);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs.map(t => t.id)).toEqual(
        runtimeOrder,
      );
    });

    await act(async () => {
      result.current.tabsController.closeOtherEditorTabs(tabTwoId);
    });
    await waitFor(() => {
      expect(result.current.tabsController.editorWorkspaceTabs.map(t => t.id)).toEqual([tabTwoId]);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: tabTwoId, history: {entries: [NOTE_2, NOTE_3], index: 1}},
      ]);
    });

    await act(async () => {
      await result.current.treeController.deleteNote(NOTE_2);
    });
    await waitFor(() => {
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: tabTwoId, history: {entries: [NOTE_3], index: 0}},
      ]);
    });

    await act(async () => {
      await result.current.treeController.renameNote(NOTE_3, 'TabThreeRenamed');
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NOTE_3_RENAMED);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: tabTwoId, history: {entries: [NOTE_3_RENAMED], index: 0}},
      ]);
    });

    expect(tabOneId).not.toBe('');
    unmount();
  });

  it('closing the last tab mirrors Home as the shadow active surface', async () => {
    const TAB_NOTE = `${VAULT_ROOT}/Inbox/LastTab.md`;
    const snapshot: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 't1', entries: [TAB_NOTE], index: 0}],
      activeEditorTabId: 't1',
      homeHistory: {entries: [HUB_A], index: 0},
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [TAB_NOTE]: 'tab\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: TAB_NOTE,
          editorWorkspaceTabs: snapshot.editorWorkspaceTabs,
          activeEditorTabId: 't1',
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: snapshot,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.tabsController.activeEditorTabId).toBe('t1');
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: 't1',
      });
    });

    await act(async () => {
      result.current.tabsController.closeEditorTab('t1');
    });

    await waitFor(() => {
      expect(result.current.tabsController.editorWorkspaceTabs).toEqual([]);
      expect(result.current.tabsController.activeEditorTabId).toBeNull();
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'home',
      });
    });

    await act(async () => {
      result.current.tabsController.reopenLastClosedEditorTab();
    });

    await waitFor(() => {
      const reopened = result.current.tabsController.editorWorkspaceTabs[0];
      expect(reopened?.history.entries).toEqual([TAB_NOTE]);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.tabs).toEqual([
        {id: reopened?.id, history: {entries: [TAB_NOTE], index: 0}},
      ]);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
        kind: 'tab',
        id: reopened?.id,
      });
    });

    unmount();
  });

  it('same-hub workspace dropdown with Home sub-page active resets Home stack to hub Today', async () => {
    const HOME_SUB = `${VAULT_ROOT}/Inbox/HomeSubReset.md`;

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [HOME_SUB]: 'sub\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    await act(async () => {
      result.current.selectionController.selectNote(HOME_SUB);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(HOME_SUB);
      expect(result.current.tabsController.editorHistoryCanGoBack).toBe(true);
    });

    await act(async () => {
      await result.current.todayHubController.switchTodayHubWorkspace(HUB_A);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory,
      ).toEqual({
        entries: [HUB_A, HOME_SUB],
        index: 0,
      });
      expect(
        result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.homeHistory,
      ).toEqual({
        entries: [HUB_A, HOME_SUB],
        index: 0,
      });
    });

    unmount();
  });

  it('keeps shadow Home history aligned when deleting the current Home sub-page', async () => {
    const HOME_SUB = `${VAULT_ROOT}/Inbox/HomeDelete.md`;

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [HOME_SUB]: 'delete me\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    await act(async () => {
      result.current.selectionController.selectNote(HOME_SUB);
    });
    await waitFor(() => {
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.homeHistory).toEqual({
        entries: [HUB_A, HOME_SUB],
        index: 1,
      });
    });

    await act(async () => {
      await result.current.treeController.deleteNote(HOME_SUB);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(HUB_A);
      expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory).toEqual({
        entries: [HUB_A],
        index: 0,
      });
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.homeHistory).toEqual({
        entries: [HUB_A],
        index: 0,
      });
    });

    unmount();
  });

  it('keeps shadow Home history aligned when renaming a Home sub-page', async () => {
    const OLD_HOME_SUB = `${VAULT_ROOT}/Inbox/HomeRenameOld.md`;
    const NEW_HOME_SUB = `${VAULT_ROOT}/Inbox/HomeRenameNew.md`;

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [OLD_HOME_SUB]: 'rename me\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    await act(async () => {
      result.current.selectionController.selectNote(OLD_HOME_SUB);
    });
    await waitFor(() => {
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.homeHistory).toEqual({
        entries: [HUB_A, OLD_HOME_SUB],
        index: 1,
      });
    });

    await act(async () => {
      await result.current.treeController.renameNote(OLD_HOME_SUB, 'HomeRenameNew');
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NEW_HOME_SUB);
      expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory).toEqual({
        entries: [HUB_A, NEW_HOME_SUB],
        index: 1,
      });
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.homeHistory).toEqual({
        entries: [HUB_A, NEW_HOME_SUB],
        index: 1,
      });
    });

    unmount();
  });

  it('same-hub workspace dropdown with Home on hub Today is a no-op', async () => {
    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`],
        files: {
          [HUB_A]: 'today\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {
              editorWorkspaceTabs: [],
              activeEditorTabId: null,
              homeHistory: {entries: [HUB_A], index: 0},
            },
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    const beforeHome = result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory;

    await act(async () => {
      await result.current.todayHubController.switchTodayHubWorkspace(HUB_A);
    });

    expect(result.current.selectionController.selectedUri).toBe(HUB_A);
    expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory).toEqual(
      beforeHome,
    );

    unmount();
  });

  it('restores workspace Home navigation stack from persisted homeHistory', async () => {
    const NOTE = `${VAULT_ROOT}/Inbox/WikiNav.md`;
    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [NOTE]: 'wiki nav\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: NOTE,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {
              editorWorkspaceTabs: [],
              activeEditorTabId: null,
              homeHistory: {
                entries: [HUB_A, NOTE],
                index: 1,
              },
            },
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.selectionController.selectedUri).toBe(NOTE);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory,
      ).toEqual({
        entries: [HUB_A, NOTE],
        index: 1,
      });
    });

    unmount();
  });

  it('restores Home sub-page alongside saved tabs on the same hub', async () => {
    const NOTE = `${VAULT_ROOT}/Inbox/HomeStack.md`;
    const TAB_NOTE = `${VAULT_ROOT}/Inbox/TabNote.md`;
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [{id: 'tab-x', entries: [TAB_NOTE], index: 0}],
      activeEditorTabId: null,
      homeHistory: {
        entries: [HUB_A, NOTE],
        index: 1,
      },
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [NOTE]: 'home stack\n',
          [TAB_NOTE]: 'tab\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: NOTE,
          editorWorkspaceTabs: snapshotA.editorWorkspaceTabs,
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: snapshotA,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.selectionController.selectedUri).toBe(NOTE);
      expect(result.current.tabsController.editorWorkspaceTabs.map(t => t.id)).toEqual([
        'tab-x',
      ]);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory,
      ).toEqual({
        entries: [HUB_A, NOTE],
        index: 1,
      });
    });

    unmount();
  });

  it('keeps independent persisted homeHistory per hub when multiple hubs restore', async () => {
    const NOTE_A = `${VAULT_ROOT}/Inbox/OnlyA.md`;
    const NOTE_B = `${VAULT_ROOT}/Inbox/OnlyB.md`;
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeHistory: {
        entries: [HUB_A, NOTE_A],
        index: 1,
      },
    };
    const snapshotB: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeHistory: {
        entries: [HUB_B, NOTE_B],
        index: 1,
      },
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/B`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today a\n',
          [HUB_B]: 'today b\n',
          [NOTE_A]: 'a\n',
          [NOTE_B]: 'b\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: NOTE_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: snapshotA,
            [HUB_B]: snapshotB,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory).toEqual(
        snapshotA.homeHistory,
      );
      expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_B]?.homeHistory).toEqual(
        snapshotB.homeHistory,
      );
    });

    unmount();
  });

  it('immediate hub switch after hydrate preserves per-hub homeHistory snapshots', async () => {
    const NOTE_A = `${VAULT_ROOT}/Inbox/ImmediateSwitchA.md`;
    const NOTE_B = `${VAULT_ROOT}/Inbox/ImmediateSwitchB.md`;
    const snapshotA: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeHistory: {
        entries: [HUB_A, NOTE_A],
        index: 1,
      },
    };
    const snapshotB: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
      homeHistory: {
        entries: [HUB_B, NOTE_B],
        index: 1,
      },
    };

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/B`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today a\n',
          [HUB_B]: 'today b\n',
          [NOTE_A]: 'a\n',
          [NOTE_B]: 'b\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: NOTE_B,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_B,
          todayHubWorkspaces: {
            [HUB_A]: snapshotA,
            [HUB_B]: snapshotB,
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    await act(async () => {
      await result.current.todayHubController.switchTodayHubWorkspace(HUB_A);
    });

    expect(result.current.todayHubController.activeTodayHubUri).toBe(HUB_A);
    expect(result.current.workspaceShadowModelForTests?.activeHub).toBe(HUB_A);
    expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.active).toEqual({
      kind: 'home',
    });
    expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory).toEqual(
      snapshotA.homeHistory,
    );
    expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_B]?.homeHistory).toEqual(
      snapshotB.homeHistory,
    );
    expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]?.homeHistory).toEqual(
      snapshotA.homeHistory,
    );
    expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_B]?.homeHistory).toEqual(
      snapshotB.homeHistory,
    );
    expect(result.current.selectionController.selectedUri).toBe(NOTE_A);

    unmount();
  });

  it('defaults Home stack when persisted snapshot omits homeHistory', async () => {
    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`],
        files: {
          [HUB_A]: 'today\n',
        },
      },
      {
        restoredInboxState: {
          vaultRoot: VAULT_ROOT,
          composingNewEntry: false,
          selectedUri: HUB_A,
          editorWorkspaceTabs: [],
          activeEditorTabId: null,
          activeTodayHubUri: HUB_A,
          todayHubWorkspaces: {
            [HUB_A]: {editorWorkspaceTabs: [], activeEditorTabId: null},
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.tabsController.editorHistoryCanGoBack).toBe(false);
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_A]?.homeHistory,
      ).toEqual({
        entries: [HUB_A],
        index: 0,
      });
    });

    unmount();
  });

  it('routes active hub Today foreground placement to Home when Home is active', () => {
    expect(
      decideHomeOpenMode({
        targetNorm: HUB_A,
        activeTodayHubUri: HUB_A,
        activeEditorTabId: null,
        options: undefined,
      }),
    ).toBe('home');
    expect(
      decideHomeOpenMode({
        targetNorm: HUB_A,
        activeTodayHubUri: null,
        activeEditorTabId: null,
        options: {home: true},
      }),
    ).toBe('home');
    expect(
      decideHomeOpenMode({
        targetNorm: HUB_A,
        activeTodayHubUri: null,
        activeEditorTabId: null,
        options: undefined,
      }),
    ).toBe('home');
    expect(
      decideHomeOpenMode({
        targetNorm: HUB_A,
        activeTodayHubUri: HUB_A,
        activeEditorTabId: null,
        options: {newTab: true},
      }),
    ).toBe('normal');
  });

  it('rapid note switches do not let a stale deferred save overwrite newer note content on disk', async () => {
    const uriA = '/vault/Inbox/Alpha.md';
    const uriB = '/vault/Inbox/Beta.md';
    const alphaSeed = 'alpha-seed';
    const betaSeed = 'beta-seed';
    const alphaFirstEdit = 'alpha-first-edit';
    const betaFinalEdit = 'beta-final-edit';
    const alphaSecondEdit = 'alpha-second-edit';

    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {
        [uriA]: `${alphaSeed}\n`,
        [uriB]: `${betaSeed}\n`,
      },
    });

    await waitFor(() => {
      expect(result.current.selectionController.notes.length).toBe(2);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(alphaSeed);
    });

    act(() => {
      result.current.selectionController.setEditorBody(alphaFirstEdit);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(alphaFirstEdit);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriB);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriB);
    });

    act(() => {
      result.current.selectionController.setEditorBody(betaFinalEdit);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(betaFinalEdit);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(alphaFirstEdit);
    });

    act(() => {
      result.current.selectionController.setEditorBody(alphaSecondEdit);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(alphaSecondEdit);
    });

    await act(async () => {
      await result.current.persistenceController.flushInboxSave();
    });

    await waitFor(async () => {
      expect(await fs.readFile(uriA, {encoding: 'utf8'})).toBe(alphaSecondEdit);
    });
    await waitFor(async () => {
      expect(await fs.readFile(uriB, {encoding: 'utf8'})).toBe(betaFinalEdit);
    });

    const betaDisk = await fs.readFile(uriB, {encoding: 'utf8'});
    expect(betaDisk).not.toContain('alpha');
    expect(betaDisk).not.toContain(alphaFirstEdit);
    expect(betaDisk).not.toContain(alphaSecondEdit);

    unmount();
  });

  it('interrupting compose by opening another note preserves prior note edits and does not leak compose text onto disk or cache', async () => {
    const uriA = '/vault/Inbox/Alpha.md';
    const uriB = '/vault/Inbox/Beta.md';
    const alphaSeed = 'alpha-seed';
    const betaSeed = 'beta-seed';
    const alphaDirty = 'alpha-dirty-edit';
    const composeDraft = 'compose-draft-unique-xyz';

    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {
        [uriA]: `${alphaSeed}\n`,
        [uriB]: `${betaSeed}\n`,
      },
    });

    await waitFor(() => {
      expect(result.current.selectionController.notes.length).toBe(2);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriA);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(alphaSeed);
    });

    act(() => {
      result.current.selectionController.setEditorBody(alphaDirty);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(alphaDirty);
    });

    act(() => {
      result.current.selectionController.startNewEntry();
    });
    await waitFor(() => {
      expect(result.current.selectionController.composingNewEntry).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe('');
    });

    act(() => {
      result.current.selectionController.setEditorBody(composeDraft);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(composeDraft);
    });

    await act(async () => {
      result.current.selectionController.selectNote(uriB);
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(uriB);
    });
    await waitFor(() => {
      expect(result.current.selectionController.composingNewEntry).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe(betaSeed);
    });

    await act(async () => {
      await result.current.persistenceController.flushInboxSave();
    });

    await waitFor(async () => {
      expect(await fs.readFile(uriA, {encoding: 'utf8'})).toBe(alphaDirty);
    });
    const betaDisk = await fs.readFile(uriB, {encoding: 'utf8'});
    expect(betaDisk).toContain(betaSeed);
    expect(betaDisk).not.toContain(composeDraft);

    const alphaDisk = await fs.readFile(uriA, {encoding: 'utf8'});
    expect(alphaDisk).not.toContain(composeDraft);

    expect(String(result.current.selectionController.inboxContentByUri[uriA] ?? '')).not.toContain(
      composeDraft,
    );
    expect(String(result.current.selectionController.inboxContentByUri[uriB] ?? '')).not.toContain(
      composeDraft,
    );

    unmount();
  });
});
