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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]
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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]
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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A],
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
      expect(result.current.tabsController.activeEditorTabId).toBe('tab-a1');
      expect(result.current.tabsController.editorWorkspaceTabs.map(t => t.id)).toEqual([
        'tab-a1',
      ]);
    });

    unmount();
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
    });

    act(() => {
      result.current.tabsController.editorHistoryGoBack();
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(hubUri);
      expect(result.current.tabsController.editorHistoryCanGoForward).toBe(true);
    });

    act(() => {
      result.current.tabsController.editorHistoryGoForward();
    });
    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(targetUri);
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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]
          ?.editorWorkspaceTabs,
      ).toEqual([]);
    });

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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]?.homeHistory,
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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]?.homeHistory,
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
      expect(result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]?.homeHistory).toEqual(
        snapshotA.homeHistory,
      );
      expect(result.current.todayHubController.todayHubWorkspacesForSave[HUB_B]?.homeHistory).toEqual(
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
    expect(result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]?.homeHistory).toEqual(
      snapshotA.homeHistory,
    );
    expect(result.current.todayHubController.todayHubWorkspacesForSave[HUB_B]?.homeHistory).toEqual(
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
        result.current.todayHubController.todayHubWorkspacesForSave[HUB_A]?.homeHistory,
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
