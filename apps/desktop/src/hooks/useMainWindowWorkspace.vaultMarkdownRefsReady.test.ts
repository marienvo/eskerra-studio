/**
 * {@link vaultMarkdownRefsReady} gating: failed vault markdown scan must not unlock hub pruning.
 */
import './useMainWindowWorkspace.integration.mocks';

import * as eskerraCore from '@eskerra/core';
import {waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  getDesktopMainWindowIntegrationMocks,
  mountHydratedMainWindowWorkspace,
} from './useMainWindowWorkspace.integration.harness';

const VAULT_ROOT = '/vault';
const HUB_A = `${VAULT_ROOT}/A/Today.md`;
const HUB_GONE = `${VAULT_ROOT}/Old/Today.md`;

describe('useMainWindowWorkspace vaultMarkdownRefs scan failure', () => {
  beforeEach(() => {
    getDesktopMainWindowIntegrationMocks().resetAll();
    vi.spyOn(eskerraCore, 'collectVaultMarkdownRefs').mockRejectedValue(new Error('disk'));
  });

  afterEach(() => {
    vi.mocked(eskerraCore.collectVaultMarkdownRefs).mockRestore();
  });

  it('does not prune restored hub workspaces when the markdown scan fails', async () => {
    const NOTE = `${VAULT_ROOT}/Inbox/n.md`;
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
      expect(result.current.workspaceShadowModelForTests?.workspaces[HUB_GONE]).toBeDefined();
      expect(result.current.todayHubController.persistenceTodayHubWorkspaces[HUB_GONE]).toBeDefined();
    });

    unmount();
  });
});
