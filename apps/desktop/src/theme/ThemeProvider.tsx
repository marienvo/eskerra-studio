import {
  BUNDLED_THEMES,
  getBundledThemeById,
  type EskerraSettings,
  type ThemeDefinition,
  type ThemeMode,
  type VaultFilesystem,
  type VaultThemeListItem,
} from '@eskerra/core';
import type {Dispatch, ReactNode, SetStateAction} from 'react';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from 'react';

import {useDesktopThemePreferenceR2EtagPollingForMainWindow} from '../hooks/useDesktopThemePreferenceR2EtagPolling';

import {ThemeShellContext, type ThemeShellContextValue} from './themeShellContext';
import {useResolvedChromeMode} from './useResolvedChromeMode';
import {useThemePreference} from './useThemePreference';
import {useVaultThemes} from './useVaultThemes';

type ThemeProviderProps = {
  vaultRoot: string | null;
  /** Null before first shared settings read; theme hooks treat as “no vault prefs”. */
  vaultSettings: EskerraSettings | null;
  setVaultSettings: Dispatch<SetStateAction<EskerraSettings | null>>;
  fs: VaultFilesystem;
  children: ReactNode;
};

function buildThemesById(vaultItems: VaultThemeListItem[]): Map<string, ThemeDefinition> {
  const m = new Map<string, ThemeDefinition>();
  for (const t of BUNDLED_THEMES) {
    m.set(t.id, t);
  }
  for (const row of vaultItems) {
    if (row.kind === 'ok') {
      m.set(row.theme.id, row.theme);
    }
  }
  return m;
}

export function ThemeProvider({
  vaultRoot,
  vaultSettings,
  setVaultSettings,
  fs,
  children,
}: ThemeProviderProps) {
  const {items: vaultThemeItems} = useVaultThemes({vaultRoot, fs});
  const {preference, setPreferenceLocal, persistPreference} = useThemePreference({
    vaultRoot,
    vaultSettings,
    setVaultSettings,
    fs,
  });

  const preferenceRef = useRef(preference);
  useEffect(() => {
    preferenceRef.current = preference;
  }, [preference]);

  const setThemeId = useCallback(
    async (themeId: string) => {
      await persistPreference({...preferenceRef.current, themeId});
    },
    [persistPreference],
  );

  const setMode = useCallback(
    async (mode: ThemeMode) => {
      await persistPreference({...preferenceRef.current, mode});
    },
    [persistPreference],
  );

  useDesktopThemePreferenceR2EtagPollingForMainWindow({
    vaultRoot,
    vaultSettings,
    onRemotePreferenceChanged: setPreferenceLocal,
  });

  const themesById = useMemo(() => buildThemesById(vaultThemeItems), [vaultThemeItems]);

  const resolvedMode = useResolvedChromeMode(preference.mode);

  const activeTheme = useMemo(() => {
    return themesById.get(preference.themeId) ?? getBundledThemeById('eskerra-default')!;
  }, [themesById, preference.themeId]);

  const chromePalette = useMemo(() => {
    return resolvedMode === 'light' ? activeTheme.light.palette : activeTheme.dark.palette;
  }, [resolvedMode, activeTheme]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const p0 = chromePalette[0] ?? '#031226';
    const p1 = chromePalette[1] ?? p0;
    root.style.setProperty('--color-app-chrome-backdrop', p0);
    root.style.setProperty('--color-app-chrome-chroma-2', p1);
    root.dataset.uiChrome = resolvedMode;
    root.style.colorScheme = resolvedMode;
  }, [chromePalette, resolvedMode]);

  const value = useMemo((): ThemeShellContextValue => {
    return {
      preference,
      resolvedMode,
      activeTheme,
      chromePalette,
      themesById,
      vaultThemeItems,
      setThemeId,
      setMode,
    };
  }, [
    preference,
    resolvedMode,
    activeTheme,
    chromePalette,
    themesById,
    vaultThemeItems,
    setThemeId,
    setMode,
  ]);

  return <ThemeShellContext.Provider value={value}>{children}</ThemeShellContext.Provider>;
}
