import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {createDesktopTestVaultFilesystem} from '../test/desktopVaultFilesystem';

const persistTransientMarkdownImagesMock = vi.hoisted(() =>
  vi.fn(async (markdown: string, _vaultRoot: string) => markdown),
);

vi.mock('../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages: persistTransientMarkdownImagesMock,
}));

const pluginStoreState = vi.hoisted(() => {
  const kv = new Map<string, unknown>();
  const store = {
    get: vi.fn(async <T>(key: string) => kv.get(key) as T),
    set: vi.fn(async (key: string, value: unknown) => {
      kv.set(key, value);
    }),
    save: vi.fn(async () => undefined),
  };
  const load = vi.fn(async () => store);
  const clear = (): void => {
    kv.clear();
    store.get.mockClear();
    store.set.mockClear();
    store.save.mockClear();
    load.mockClear();
  };
  return {kv, store, load, clear};
});

vi.mock('@tauri-apps/plugin-store', () => ({
  load: pluginStoreState.load,
}));

const tauriVaultMocks = vi.hoisted(() => ({
  setVaultSession: vi.fn(async (_rootPath: string) => undefined),
  getVaultSession: vi.fn(async () => null),
  startVaultWatch: vi.fn(async () => undefined),
}));

vi.mock('../lib/tauriVault', () => ({
  setVaultSession: tauriVaultMocks.setVaultSession,
  getVaultSession: tauriVaultMocks.getVaultSession,
  startVaultWatch: tauriVaultMocks.startVaultWatch,
}));

const vaultSearchMocks = vi.hoisted(() => ({
  vaultSearchIndexSchedule: vi.fn(async () => undefined),
  vaultSearchIndexTouchPaths: vi.fn(async (_paths: string[]) => undefined),
}));

vi.mock('../lib/tauriVaultSearch', () => ({
  vaultSearchIndexSchedule: vaultSearchMocks.vaultSearchIndexSchedule,
  vaultSearchIndexTouchPaths: vaultSearchMocks.vaultSearchIndexTouchPaths,
}));

const vaultFrontmatterMocks = vi.hoisted(() => ({
  vaultFrontmatterIndexSchedule: vi.fn(async () => undefined),
  vaultFrontmatterIndexTouchPaths: vi.fn(async (_paths: string[]) => undefined),
}));

vi.mock('../lib/tauriVaultFrontmatter', () => ({
  vaultFrontmatterIndexSchedule: vaultFrontmatterMocks.vaultFrontmatterIndexSchedule,
  vaultFrontmatterIndexTouchPaths: vaultFrontmatterMocks.vaultFrontmatterIndexTouchPaths,
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(async (_channel: string, _handler: (e: {payload: unknown}) => void) =>
    vi.fn(),
  ),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: eventMocks.listen,
}));

import {useMainWindowWorkspace} from './useMainWindowWorkspace';

describe('useMainWindowWorkspace + fake VaultFilesystem (hydrateVault)', () => {
  beforeEach(() => {
    pluginStoreState.clear();
    tauriVaultMocks.setVaultSession.mockClear();
    tauriVaultMocks.getVaultSession.mockClear();
    tauriVaultMocks.startVaultWatch.mockClear();
    vaultSearchMocks.vaultSearchIndexSchedule.mockClear();
    vaultSearchMocks.vaultSearchIndexTouchPaths.mockClear();
    vaultFrontmatterMocks.vaultFrontmatterIndexSchedule.mockClear();
    vaultFrontmatterMocks.vaultFrontmatterIndexTouchPaths.mockClear();
    eventMocks.listen.mockClear();
    persistTransientMarkdownImagesMock.mockClear();
  });

  it('hydrateVault bootstraps the vault on the fake fs and wires session + watch', async () => {
    const {fs} = createDesktopTestVaultFilesystem({
      dirs: ['/vault'],
    });

    const inboxEditorRef: {current: null} = {current: null};
    const inboxEditorShellScrollRef: {current: null} = {current: null};

    const {result, unmount} = renderHook(() =>
      useMainWindowWorkspace({
        fs,
        inboxEditorRef,
        inboxEditorShellScrollRef,
        restoredInboxState: null,
        inboxRestoreEnabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.initialVaultHydrateAttemptDone).toBe(true);
    });
    expect(result.current.vaultRoot).toBeNull();

    await act(async () => {
      await result.current.hydrateVault('/vault');
    });

    await waitFor(() => {
      expect(result.current.vaultRoot).toBe('/vault');
    });

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
});
