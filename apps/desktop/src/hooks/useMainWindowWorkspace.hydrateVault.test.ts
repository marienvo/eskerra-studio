import {act, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it} from 'vitest';

import {
  getDesktopMainWindowIntegrationMocks,
  mountHydratedMainWindowWorkspace,
} from './useMainWindowWorkspace.integration.harness';

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
