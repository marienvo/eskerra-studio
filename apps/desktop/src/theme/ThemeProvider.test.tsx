import {render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {VaultFilesystem} from '@eskerra/core';

import type {StartupThemeBootstrap} from './startupThemeBootstrap';
import {ThemeProvider} from './ThemeProvider';
import {useThemeShell} from './themeShellContext';

const startupMocks = vi.hoisted(() => ({
  readStartupThemeBootstrap: vi.fn<[], StartupThemeBootstrap | null>(),
  persistStartupThemeBootstrap: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('../hooks/useDesktopThemePreferenceR2EtagPolling', () => ({
  useDesktopThemePreferenceR2EtagPollingForMainWindow: vi.fn(),
}));

vi.mock('./startupThemeBootstrap', () => ({
  readStartupThemeBootstrap: () => startupMocks.readStartupThemeBootstrap(),
  persistStartupThemeBootstrap: (...args: unknown[]) =>
    startupMocks.persistStartupThemeBootstrap(...args),
  parseStartupThemeBootstrap: vi.fn(),
  releaseStartupThemeLock: vi.fn(),
}));

const fs = {} as VaultFilesystem;

const vaultStartup: StartupThemeBootstrap = {
  preference: {themeId: 'my-vault-theme', mode: 'dark'},
  resolvedMode: 'dark',
  theme: {
    id: 'my-vault-theme',
    name: 'My Vault Theme',
    source: 'vault',
    light: {palette: ['#F5F5F5']},
    dark: {palette: ['#111111']},
    fileName: 'my-vault-theme.json',
  },
};

function ActiveThemeIdProbe() {
  const {activeTheme} = useThemeShell();
  return <span data-testid="active-theme-id">{activeTheme.id}</span>;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startupMocks.readStartupThemeBootstrap.mockReturnValue(vaultStartup);
  });

  it('does not fall back to eskerra-default while vaultRoot is null and startup theme is vault', async () => {
    const setVaultSettings = vi.fn();

    render(
      <ThemeProvider
        vaultRoot={null}
        vaultSettings={null}
        setVaultSettings={setVaultSettings}
        fs={fs}>
        <ActiveThemeIdProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('active-theme-id').textContent).toBe('my-vault-theme');

    await waitFor(() => {
      expect(screen.getByTestId('active-theme-id').textContent).toBe('my-vault-theme');
    });

    await waitFor(() => {
      expect(startupMocks.persistStartupThemeBootstrap).toHaveBeenCalled();
    });
    const persistArg = startupMocks.persistStartupThemeBootstrap.mock.calls.at(-1)?.[0] as {
      preference: {themeId: string};
      theme: {id: string};
    };
    expect(persistArg.preference.themeId).toBe('my-vault-theme');
    expect(persistArg.theme.id).toBe('my-vault-theme');
  });

  it('does not persist startup cache when active theme id mismatches preference', async () => {
    startupMocks.readStartupThemeBootstrap.mockReturnValue({
      preference: {themeId: 'unknown-other', mode: 'dark'},
      resolvedMode: 'dark',
      theme: vaultStartup.theme,
    });
    const setVaultSettings = vi.fn();

    render(
      <ThemeProvider
        vaultRoot={null}
        vaultSettings={null}
        setVaultSettings={setVaultSettings}
        fs={fs}>
        <ActiveThemeIdProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-theme-id').textContent).toBe('eskerra-default');
    });

    expect(startupMocks.persistStartupThemeBootstrap).not.toHaveBeenCalled();
  });

  it('does not persist startup bootstrap until shared settings load when vault is open', async () => {
    const setVaultSettings = vi.fn();

    render(
      <ThemeProvider
        vaultRoot="/vault"
        vaultSettings={null}
        setVaultSettings={setVaultSettings}
        fs={fs}>
        <ActiveThemeIdProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-theme-id').textContent).toBe('my-vault-theme');
    });

    expect(startupMocks.persistStartupThemeBootstrap).not.toHaveBeenCalled();
  });
});
