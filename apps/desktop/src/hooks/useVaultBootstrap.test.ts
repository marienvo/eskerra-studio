import {act, renderHook} from '@testing-library/react';
import {SubtreeMarkdownPresenceCache} from '@eskerra/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {createDesktopTestVaultFilesystem} from '../test/desktopVaultFilesystem';

const vbMocks = vi.hoisted(() => {
  const pluginStore = {
    get: vi.fn(async () => ''),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  };
  return {
    setVaultSession: vi.fn(async () => undefined),
    getVaultSession: vi.fn(async () => null),
    startVaultWatch: vi.fn(async () => undefined),
    pluginLoad: vi.fn(async () => pluginStore),
    bootstrapVaultLayout: vi.fn(async () => undefined),
    readVaultSettings: vi.fn(async () => ({})),
    readVaultLocalSettings: vi.fn(async () => ({
      deviceInstanceId: 'test-device',
      displayName: 'Test',
      deviceName: '',
      playlistKnownUpdatedAtMs: null,
    })),
    writeVaultLocalSettings: vi.fn(async () => undefined),
  };
});

vi.mock('../lib/tauriVault', () => ({
  setVaultSession: vbMocks.setVaultSession,
  getVaultSession: vbMocks.getVaultSession,
  startVaultWatch: vbMocks.startVaultWatch,
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vbMocks.pluginLoad,
}));

vi.mock('../lib/tauriVaultSearch', () => ({
  vaultSearchIndexSchedule: vi.fn(async () => undefined),
}));

vi.mock('../lib/tauriVaultFrontmatter', () => ({
  vaultFrontmatterIndexSchedule: vi.fn(async () => undefined),
}));

vi.mock('../lib/vaultBootstrap', () => ({
  bootstrapVaultLayout: vbMocks.bootstrapVaultLayout,
  readVaultSettings: vbMocks.readVaultSettings,
  readVaultLocalSettings: vbMocks.readVaultLocalSettings,
  writeVaultLocalSettings: vbMocks.writeVaultLocalSettings,
}));

import {useVaultBootstrap} from './useVaultBootstrap';

describe('useVaultBootstrap', () => {
  beforeEach(() => {
    vbMocks.setVaultSession.mockReset();
    vbMocks.setVaultSession.mockResolvedValue(undefined);
    vbMocks.getVaultSession.mockReset();
    vbMocks.getVaultSession.mockResolvedValue(null);
    vbMocks.startVaultWatch.mockReset();
    vbMocks.startVaultWatch.mockResolvedValue(undefined);
    vbMocks.pluginLoad.mockClear();
    vbMocks.bootstrapVaultLayout.mockClear();
    vbMocks.readVaultSettings.mockClear();
    vbMocks.readVaultLocalSettings.mockClear();
    vbMocks.writeVaultLocalSettings.mockClear();
  });

  it('clears disk-conflict UI after flush and before vault session, even when hydrate fails', async () => {
    vbMocks.setVaultSession.mockRejectedValueOnce(new Error('vault session failed'));

    const {fs} = createDesktopTestVaultFilesystem({dirs: ['/v']});
    const flushInboxSave = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const flushInboxSaveRef = {current: flushInboxSave};
    const clearDiskConflictUi = vi.fn();
    const clearDiskConflictUiForHydrateRef = {current: clearDiskConflictUi};
    const resetWorkspaceStateRef = {current: vi.fn()};
    const resetRenameMaintenanceStateRef = {current: vi.fn()};
    const clearBacklinkDiskBodyCacheRef = {current: vi.fn()};
    const refreshNotes = vi.fn(async () => undefined);

    const {result} = renderHook(() =>
      useVaultBootstrap({
        fs,
        inboxRestoreEnabled: true,
        flushInboxSaveRef,
        subtreeMarkdownCache: new SubtreeMarkdownPresenceCache(),
        resetRenameMaintenanceStateRef,
        clearBacklinkDiskBodyCacheRef,
        refreshNotes,
        resetWorkspaceStateRef,
        clearDiskConflictUiForHydrateRef,
        setInboxShellRestored: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.hydrateVault('/v');
    });

    expect(flushInboxSave).toHaveBeenCalledTimes(1);
    expect(clearDiskConflictUi).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceStateRef.current).not.toHaveBeenCalled();
    expect(vbMocks.setVaultSession).toHaveBeenCalledWith('/v');
    expect(flushInboxSave.mock.invocationCallOrder[0]).toBeLessThan(
      clearDiskConflictUi.mock.invocationCallOrder[0],
    );
    expect(clearDiskConflictUi.mock.invocationCallOrder[0]).toBeLessThan(
      vbMocks.setVaultSession.mock.invocationCallOrder[0],
    );
  });
});
