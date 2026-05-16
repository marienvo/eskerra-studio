import {load} from '@tauri-apps/plugin-store';
import type {ThemeDefinition, ThemePreference} from '@eskerra/core';

const STORE_PATH = 'eskerra-desktop.json';
const STORE_KEY_STARTUP_THEME = 'startupTheme';

export type StartupThemeBootstrap = {
  preference: ThemePreference;
  resolvedMode: 'light' | 'dark';
  theme: ThemeDefinition;
};

function isThemeMode(value: unknown): value is ThemePreference['mode'] {
  return value === 'light' || value === 'dark' || value === 'auto';
}

function isResolvedMode(value: unknown): value is StartupThemeBootstrap['resolvedMode'] {
  return value === 'light' || value === 'dark';
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function parsePalette(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    return null;
  }
  const out: string[] = [];
  for (const item of value) {
    if (!isHexColor(item)) {
      return null;
    }
    out.push(item.trim());
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parsePreference(value: unknown): ThemePreference | null {
  const prefObj = asRecord(value);
  if (!prefObj) {
    return null;
  }
  const themeId = typeof prefObj.themeId === 'string' ? prefObj.themeId.trim() : '';
  if (!themeId || !isThemeMode(prefObj.mode)) {
    return null;
  }
  return {themeId, mode: prefObj.mode};
}

function parseThemeSource(value: unknown): ThemeDefinition['source'] | null {
  if (value === 'vault') {
    return 'vault';
  }
  if (value === 'bundled') {
    return 'bundled';
  }
  return null;
}

function parsePaletteFromThemeMode(value: unknown): string[] | null {
  const modeObj = asRecord(value);
  return modeObj ? parsePalette(modeObj.palette) : null;
}

function parseFileName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseTheme(value: unknown): ThemeDefinition | null {
  const themeObj = asRecord(value);
  if (!themeObj) {
    return null;
  }
  const id = typeof themeObj.id === 'string' ? themeObj.id.trim() : '';
  const name = typeof themeObj.name === 'string' ? themeObj.name.trim() : '';
  const source = parseThemeSource(themeObj.source);
  const light = parsePaletteFromThemeMode(themeObj.light);
  const dark = parsePaletteFromThemeMode(themeObj.dark);
  if (!id || !name || !source || !light || !dark) {
    return null;
  }
  const fileName = parseFileName(themeObj.fileName);
  return {
    id,
    name,
    source,
    light: {palette: light},
    dark: {palette: dark},
    ...(fileName ? {fileName} : {}),
  };
}

export function parseStartupThemeBootstrap(value: unknown): StartupThemeBootstrap | null {
  const root = asRecord(value);
  if (!root) {
    return null;
  }
  const preference = parsePreference(root.preference);
  if (!preference) {
    return null;
  }
  if (!isResolvedMode(root.resolvedMode)) {
    return null;
  }
  const theme = parseTheme(root.theme);
  if (!theme) {
    return null;
  }
  return {
    preference,
    resolvedMode: root.resolvedMode,
    theme,
  };
}

export function readStartupThemeBootstrap(): StartupThemeBootstrap | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return parseStartupThemeBootstrap(window.__ESKERRA_STARTUP_THEME__);
}

export async function persistStartupThemeBootstrap(next: StartupThemeBootstrap): Promise<void> {
  const store = await load(STORE_PATH);
  await store.set(STORE_KEY_STARTUP_THEME, next);
  await store.save();
}

export function releaseStartupThemeLock(): void {
  if (typeof document === 'undefined') {
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      delete document.documentElement.dataset.startupThemeLock;
    });
  });
}
