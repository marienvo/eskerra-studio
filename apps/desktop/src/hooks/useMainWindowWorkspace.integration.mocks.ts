/**
 * Shared Vitest module mocks for `useMainWindowWorkspace` integration tests.
 * Import this module before importing the hook under test.
 */

import {vi} from 'vitest';

const desktopMainWindowIntegrationMocks = vi.hoisted(() => {
  const persistTransientMarkdownImagesMock = vi.fn(
    async (markdown: string, _vaultRoot: string) => markdown,
  );

  const pluginKv = new Map<string, unknown>();
  const pluginStore = {
    get: vi.fn(async <T>(key: string) => pluginKv.get(key) as T),
    set: vi.fn(async (key: string, value: unknown) => {
      pluginKv.set(key, value);
    }),
    save: vi.fn(async () => undefined),
  };
  const pluginLoad = vi.fn(async () => pluginStore);
  const clearPluginStore = (): void => {
    pluginKv.clear();
    pluginStore.get.mockClear();
    pluginStore.set.mockClear();
    pluginStore.save.mockClear();
    pluginLoad.mockClear();
  };

  const tauriVaultMocks = {
    setVaultSession: vi.fn(async (_rootPath: string) => undefined),
    getVaultSession: vi.fn(async () => null),
    startVaultWatch: vi.fn(async () => undefined),
  };

  const vaultSearchMocks = {
    vaultSearchIndexSchedule: vi.fn(async () => undefined),
    vaultSearchIndexTouchPaths: vi.fn(async (_paths: string[]) => undefined),
  };

  const vaultFrontmatterMocks = {
    vaultFrontmatterIndexSchedule: vi.fn(async () => undefined),
    vaultFrontmatterIndexTouchPaths: vi.fn(async (_paths: string[]) => undefined),
  };

  const eventMocks = {
    listen: vi.fn(
      async (_channel: string, _handler: (e: {payload: unknown}) => void) => vi.fn(),
    ),
  };

  const resetAll = (): void => {
    clearPluginStore();
    tauriVaultMocks.setVaultSession.mockClear();
    tauriVaultMocks.getVaultSession.mockClear();
    tauriVaultMocks.startVaultWatch.mockClear();
    vaultSearchMocks.vaultSearchIndexSchedule.mockClear();
    vaultSearchMocks.vaultSearchIndexTouchPaths.mockClear();
    vaultFrontmatterMocks.vaultFrontmatterIndexSchedule.mockClear();
    vaultFrontmatterMocks.vaultFrontmatterIndexTouchPaths.mockClear();
    eventMocks.listen.mockClear();
    persistTransientMarkdownImagesMock.mockClear();
  };

  return {
    persistTransientMarkdownImagesMock,
    pluginStoreState: {kv: pluginKv, store: pluginStore, load: pluginLoad, clear: clearPluginStore},
    tauriVaultMocks,
    vaultSearchMocks,
    vaultFrontmatterMocks,
    eventMocks,
    resetAll,
  };
});

vi.mock('../lib/persistTransientMarkdownImages', () => ({
  persistTransientMarkdownImages:
    desktopMainWindowIntegrationMocks.persistTransientMarkdownImagesMock,
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: desktopMainWindowIntegrationMocks.pluginStoreState.load,
}));

vi.mock('../lib/tauriVault', () => ({
  setVaultSession: desktopMainWindowIntegrationMocks.tauriVaultMocks.setVaultSession,
  getVaultSession: desktopMainWindowIntegrationMocks.tauriVaultMocks.getVaultSession,
  startVaultWatch: desktopMainWindowIntegrationMocks.tauriVaultMocks.startVaultWatch,
}));

vi.mock('../lib/tauriVaultSearch', () => ({
  vaultSearchIndexSchedule:
    desktopMainWindowIntegrationMocks.vaultSearchMocks.vaultSearchIndexSchedule,
  vaultSearchIndexTouchPaths:
    desktopMainWindowIntegrationMocks.vaultSearchMocks.vaultSearchIndexTouchPaths,
}));

vi.mock('../lib/tauriVaultFrontmatter', () => ({
  vaultFrontmatterIndexSchedule:
    desktopMainWindowIntegrationMocks.vaultFrontmatterMocks.vaultFrontmatterIndexSchedule,
  vaultFrontmatterIndexTouchPaths:
    desktopMainWindowIntegrationMocks.vaultFrontmatterMocks.vaultFrontmatterIndexTouchPaths,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: desktopMainWindowIntegrationMocks.eventMocks.listen,
}));

export function getDesktopMainWindowIntegrationMocks(): typeof desktopMainWindowIntegrationMocks {
  return desktopMainWindowIntegrationMocks;
}
