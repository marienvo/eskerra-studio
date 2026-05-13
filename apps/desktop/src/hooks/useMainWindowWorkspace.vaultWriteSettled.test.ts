import {act, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

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
});
