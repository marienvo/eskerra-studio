import {act, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

import {
  getDesktopMainWindowIntegrationMocks,
  mountHydratedMainWindowWorkspace,
} from './useMainWindowWorkspace.integration.harness';

const VAULT_ROOT = '/vault';
const HUB_A = `${VAULT_ROOT}/A/Today.md`;

describe('useMainWindowWorkspace + fake VaultFilesystem (vaultWriteSettled)', () => {
  beforeEach(() => {
    getDesktopMainWindowIntegrationMocks().resetAll();
  });

  it('increments the vault write settled signal once after a normal note save', async () => {
    const uri = '/vault/Inbox/SaveSignal.md';
    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {
        [uri]: 'seed\n',
      },
    });

    await act(async () => {
      result.current.selectionController.selectNote(uri);
    });
    await waitFor(() => {
      expect(result.current.selectionController.editorBody).toBe('seed');
    });

    const before = result.current.persistenceController.saveSettledNonce;
    act(() => {
      result.current.selectionController.setEditorBody('changed');
    });

    await act(async () => {
      await result.current.persistenceController.flushInboxSave();
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });
    expect(await fs.readFile(uri, {encoding: 'utf8'})).toBe('changed');

    unmount();
  });

  it('increments the vault write settled signal after a TodayHub row write', async () => {
    const rowUri = '/vault/A/2026-05-12.md';
    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/A'],
      files: {
        [HUB_A]: 'today\n',
      },
    });

    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.todayHubController.persistTodayHubRow(rowUri, 'today row', 1);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });
    expect(await fs.readFile(rowUri, {encoding: 'utf8'})).toBe('today row');

    unmount();
  });

  it('does not increment the vault write settled signal after a failed TodayHub row write', async () => {
    const rowUri = '/vault/A/2026-05-12.md';
    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/A'],
      files: {
        [HUB_A]: 'today\n',
      },
    });
    const originalWriteFile = fs.writeFile;
    fs.writeFile = async () => {
      throw new Error('write failed');
    };
    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.todayHubController.persistTodayHubRow(rowUri, 'today row', 1);
    });

    expect(result.current.persistenceController.saveSettledNonce).toBe(before);
    expect(result.current.notificationsState.err).toBe('write failed');

    fs.writeFile = originalWriteFile;
    unmount();
  });

  it('increments the vault write settled signal at most once per successful TodayHub row write', async () => {
    const firstRowUri = '/vault/A/2026-05-12.md';
    const secondRowUri = '/vault/A/2026-05-13.md';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/A'],
      files: {
        [HUB_A]: 'today\n',
      },
    });
    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await Promise.all([
        result.current.todayHubController.persistTodayHubRow(firstRowUri, 'one', 1),
        result.current.todayHubController.persistTodayHubRow(secondRowUri, 'two', 1),
      ]);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 2);
    });

    unmount();
  });

  // --- tree mutation callbacks ---

  it('increments the vault write settled signal once after deleteNote', async () => {
    const noteUri = '/vault/Inbox/ToDelete.md';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {[noteUri]: 'delete me\n'},
    });

    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.treeController.deleteNote(noteUri);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });

    unmount();
  });

  it('does not increment the vault write settled signal when deleteNote fails', async () => {
    const noteUri = '/vault/Inbox/ToDelete.md';
    const {fs, result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {[noteUri]: 'delete me\n'},
    });

    const originalUnlink = fs.unlink;
    fs.unlink = async () => {
      throw new Error('disk error');
    };

    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.treeController.deleteNote(noteUri);
    });

    expect(result.current.persistenceController.saveSettledNonce).toBe(before);

    fs.unlink = originalUnlink;
    unmount();
  });

  it('increments the vault write settled signal once after deleteFolder', async () => {
    const folderUri = '/vault/UserNotes';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', folderUri],
      files: {[`${folderUri}/Note.md`]: 'note\n'},
    });

    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.treeController.deleteFolder(folderUri);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });

    unmount();
  });

  it('increments the vault write settled signal once after renameFolder', async () => {
    const folderUri = '/vault/OldName';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', folderUri],
      files: {[`${folderUri}/Note.md`]: 'note\n'},
    });

    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.treeController.renameFolder(folderUri, 'NewName');
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });

    unmount();
  });

  it('increments the vault write settled signal once after moveVaultTreeItem', async () => {
    const sourceUri = '/vault/Source/Note.md';
    const targetDir = '/vault/Target';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Source', targetDir],
      files: {[sourceUri]: 'note\n'},
    });

    const before = result.current.persistenceController.saveSettledNonce;

    await act(async () => {
      await result.current.treeController.moveVaultTreeItem(sourceUri, 'article', targetDir);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });

    unmount();
  });

  it('increments the vault write settled signal exactly once after bulkDeleteVaultTreeItems (batch of two)', async () => {
    const noteA = '/vault/Inbox/NoteA.md';
    const noteB = '/vault/Inbox/NoteB.md';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Inbox'],
      files: {[noteA]: 'a\n', [noteB]: 'b\n'},
    });

    const before = result.current.persistenceController.saveSettledNonce;
    const items: VaultTreeBulkItem[] = [
      {uri: noteA, kind: 'article'},
      {uri: noteB, kind: 'article'},
    ];

    await act(async () => {
      await result.current.treeController.bulkDeleteVaultTreeItems(items);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });

    unmount();
  });

  it('increments the vault write settled signal exactly once after bulkMoveVaultTreeItems (batch of two)', async () => {
    const noteA = '/vault/Source/NoteA.md';
    const noteB = '/vault/Source/NoteB.md';
    const targetDir = '/vault/Target';
    const {result, unmount} = await mountHydratedMainWindowWorkspace({
      dirs: ['/vault', '/vault/Source', targetDir],
      files: {[noteA]: 'a\n', [noteB]: 'b\n'},
    });

    const before = result.current.persistenceController.saveSettledNonce;
    const items: VaultTreeBulkItem[] = [
      {uri: noteA, kind: 'article'},
      {uri: noteB, kind: 'article'},
    ];

    await act(async () => {
      await result.current.treeController.bulkMoveVaultTreeItems(items, targetDir);
    });

    await waitFor(() => {
      expect(result.current.persistenceController.saveSettledNonce).toBe(before + 1);
    });

    unmount();
  });
});
