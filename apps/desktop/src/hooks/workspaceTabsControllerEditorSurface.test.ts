/**
 * {@link tabsControllerEditorSurface} + integration: tab chrome when no Today.md hub exists.
 */
import './useMainWindowWorkspace.integration.mocks';

import {act, waitFor} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {tabsControllerEditorSurface} from './workspaceRuntimeProjection';
import {mountHydratedMainWindowWorkspace} from './useMainWindowWorkspace.integration.harness';

const VAULT_ROOT = '/vault';

describe('tabsControllerEditorSurface', () => {
  it('uses legacy tabs when activeHub is null', () => {
    const legacyTabs = [{id: 'a', history: {entries: ['/x'], index: 0}}];
    expect(tabsControllerEditorSurface(null, [], null, legacyTabs, 'a')).toEqual([
      legacyTabs,
      'a',
    ]);
  });

  it('uses model tabs when activeHub is set', () => {
    const modelTabs = [{id: 'b', history: {entries: ['/y'], index: 0}}];
    expect(
      tabsControllerEditorSurface('/vault/D/Today.md', modelTabs, 'b', [], null),
    ).toEqual([modelTabs, 'b']);
  });
});

describe('tabsController without Today hub', () => {
  it('mirrors opened inbox tab in tabsController', async () => {
    const NOTE = `${VAULT_ROOT}/Inbox/only.md`;
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: [VAULT_ROOT, `${VAULT_ROOT}/Inbox`],
      files: {[NOTE]: 'body\n'},
    });

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    expect(result.current.workspaceShadowModelForTests?.activeHub).toBeNull();

    await act(async () => {
      await result.current.selectionController.selectNoteInNewActiveTab(NOTE);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NOTE);
    });

    expect(result.current.tabsController.editorWorkspaceTabs).toHaveLength(1);
    expect(result.current.tabsController.editorWorkspaceTabs[0]?.history.entries).toEqual([
      NOTE,
    ]);
    expect(result.current.tabsController.activeEditorTabId).toBe(
      result.current.tabsController.editorWorkspaceTabs[0]?.id,
    );

    unmount();
  });

  it('enables editor back when legacy tab history has prior entries (no Today hub)', async () => {
    const NOTE_A = `${VAULT_ROOT}/Inbox/a.md`;
    const NOTE_B = `${VAULT_ROOT}/Inbox/b.md`;
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: [VAULT_ROOT, `${VAULT_ROOT}/Inbox`],
      files: {[NOTE_A]: 'a\n', [NOTE_B]: 'b\n'},
    });

    await waitFor(() => {
      expect(result.current.inboxShellRestored).toBe(true);
    });

    expect(result.current.workspaceShadowModelForTests?.activeHub).toBeNull();

    await act(async () => {
      await result.current.selectionController.selectNoteInNewActiveTab(NOTE_A);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NOTE_A);
    });

    await act(async () => {
      result.current.selectionController.selectNote(NOTE_B);
    });

    await waitFor(() => {
      expect(result.current.selectionController.selectedUri).toBe(NOTE_B);
      expect(result.current.tabsController.editorWorkspaceTabs[0]?.history.entries).toEqual([
        NOTE_A,
        NOTE_B,
      ]);
      expect(result.current.tabsController.editorWorkspaceTabs[0]?.history.index).toBe(1);
      expect(result.current.tabsController.editorHistoryCanGoBack).toBe(true);
    });

    unmount();
  });
});
