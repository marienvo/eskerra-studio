/**
 * Stale Today hub pruning after shell restore (kept out of hydrateVault.test.ts module budget).
 */
import {waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {
  getDesktopMainWindowIntegrationMocks,
  mountHydratedMainWindowWorkspace,
} from './useMainWindowWorkspace.integration.harness';

const VAULT_ROOT = '/vault';
const HUB_A = `${VAULT_ROOT}/A/Today.md`;

describe('useMainWindowWorkspace hydrate stale hub workspaces', () => {
  beforeEach(() => {
    getDesktopMainWindowIntegrationMocks().resetAll();
  });

  it('drops persisted hub keys after hydrate when hub file is absent from vault', async () => {
    const NOTE = `${VAULT_ROOT}/Inbox/n.md`;
    const HUB_GONE = `${VAULT_ROOT}/Old/Today.md`;

    const {result, unmount} = await mountHydratedMainWindowWorkspace(
      {
        dirs: [VAULT_ROOT, `${VAULT_ROOT}/A`, `${VAULT_ROOT}/Inbox`],
        files: {
          [HUB_A]: 'today\n',
          [NOTE]: 'n\n',
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
            [HUB_GONE]: {
              editorWorkspaceTabs: [{id: 'g1', entries: [NOTE], index: 0}],
              activeEditorTabId: 'g1',
            },
          },
        },
      },
    );

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_GONE]).toBeUndefined();
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_A]).toBeDefined();
      expect(
        result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_GONE],
      ).toBeUndefined();
    });

    unmount();
  });
});
