import {
  BUNDLED_THEMES,
  getThemesDirectoryUri,
  normalizeVaultBaseUri,
  pickUniqueThemeStem,
  serializeVaultThemeJson,
  toKebabIdFromName,
  type ThemeDefinition,
  type ThemeMode,
  writeVaultTheme,
} from '@eskerra/core';
import {revealPathInSystemExplorer} from '../../lib/revealPathInSystemExplorer';
import {useCallback, useMemo, useState} from 'react';

import {AppChromeBackground} from '../AppChromeBackground';

import {useThemeShell} from '../../theme/themeShellContext';

type ThemesTabProps = {
  vaultRoot: string;
  fs: import('@eskerra/core').VaultFilesystem;
};

type ContextMenuState = {x: number; y: number; theme: ThemeDefinition} | null;

function ThemeCardPreview({palette}: {palette: readonly string[]}) {
  return (
    <div className="themes-tab-card-preview" aria-hidden>
      <AppChromeBackground palette={palette} blurStdDeviation={14} />
    </div>
  );
}

export function ThemesTab({vaultRoot, fs}: ThemesTabProps) {
  const {preference, resolvedMode, vaultThemeItems, setThemeId, setMode} = useThemeShell();
  const modeLabel = (mode: ThemeMode): string => {
    if (mode === 'auto') {
      return 'Auto';
    }
    if (mode === 'light') {
      return 'Light';
    }
    return 'Dark';
  };

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [exportDialog, setExportDialog] = useState<{source: ThemeDefinition} | null>(null);
  const [exportName, setExportName] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  const vaultStems = useMemo(() => {
    const s = new Set<string>();
    for (const row of vaultThemeItems) {
      if (row.kind === 'ok') {
        s.add(row.theme.id);
      }
    }
    return s;
  }, [vaultThemeItems]);

  const orderedThemes = useMemo(() => {
    const rows: Array<
      | {kind: 'ok'; source: 'bundled' | 'vault'; theme: ThemeDefinition}
      | {kind: 'error'; fileName: string; message: string}
    > = [];
    for (const t of BUNDLED_THEMES) {
      rows.push({kind: 'ok', source: 'bundled', theme: t});
    }
    for (const item of vaultThemeItems) {
      if (item.kind === 'ok') {
        rows.push({kind: 'ok', source: 'vault', theme: item.theme});
      } else {
        rows.push({kind: 'error', fileName: item.fileName, message: item.error.message});
      }
    }
    return rows;
  }, [vaultThemeItems]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openExportDialog = useCallback((source: ThemeDefinition) => {
    setExportName(source.name);
    setExportError(null);
    setExportDialog({source});
    closeContextMenu();
  }, [closeContextMenu]);

  const confirmExport = useCallback(async () => {
    if (!exportDialog) {
      return;
    }
    const name = exportName.trim();
    if (!name) {
      setExportError('Enter a name.');
      return;
    }
    const base = toKebabIdFromName(name);
    const stem = pickUniqueThemeStem(base, vaultStems);
    const fileName = `${stem}.json`;
    const theme: ThemeDefinition = {
      ...exportDialog.source,
      id: stem,
      name,
      source: 'vault',
      fileName,
    };
    const json = serializeVaultThemeJson(theme);
    try {
      await writeVaultTheme(vaultRoot, fs, theme, json);
      setExportDialog(null);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }, [exportDialog, exportName, vaultRoot, fs, vaultStems]);

  const revealThemeFile = useCallback(
    async (theme: ThemeDefinition) => {
      if (theme.source !== 'vault' || !theme.fileName) {
        return;
      }
      const dir = getThemesDirectoryUri(normalizeVaultBaseUri(vaultRoot));
      const path = `${dir}/${theme.fileName}`;
      try {
        await revealPathInSystemExplorer(path);
      } catch {
        // ignore
      }
      closeContextMenu();
    },
    [vaultRoot, closeContextMenu],
  );

  return (
    <div className="themes-tab" onClick={() => contextMenu != null && closeContextMenu()}>
      <div className="themes-tab-toolbar">
        <span className="themes-tab-toolbar-label">Appearance</span>
        <div className="themes-tab-mode-toggle" role="group" aria-label="Light or dark chrome">
          {(['light', 'dark', 'auto'] as const).map(m => (
            <button
              key={m}
              type="button"
              className={
                preference.mode === m ? 'themes-tab-mode-toggle__btn is-active' : 'themes-tab-mode-toggle__btn'
              }
              onClick={() => void setMode(m as ThemeMode)}>
              {modeLabel(m as ThemeMode)}
            </button>
          ))}
        </div>
      </div>

      <p className="themes-tab-hint muted small">
        Vault themes live in <code>.eskerra/themes/</code>. Edit JSON on disk; changes appear here automatically.
      </p>

      <ul className="themes-tab-grid">
        {orderedThemes.map(row => {
          if (row.kind === 'error') {
            return (
              <li key={`err-${row.fileName}`}>
                <div className="themes-tab-card themes-tab-card--error themes-tab-card--static">
                  <p className="themes-tab-card-name">{row.fileName}</p>
                  <p className="themes-tab-card-error small" role="alert">
                    {row.message}
                  </p>
                </div>
              </li>
            );
          }
          const t = row.theme;
          const palette = resolvedMode === 'light' ? t.light.palette : t.dark.palette;
          const active = preference.themeId === t.id;
          return (
            <li key={`${row.source}-${t.id}`}>
              <button
                type="button"
                className={`themes-tab-card${active ? ' themes-tab-card--active' : ''}`}
                onClick={() => void setThemeId(t.id)}
                onContextMenu={e => {
                  e.preventDefault();
                  setContextMenu({x: e.clientX, y: e.clientY, theme: t});
                }}>
                <ThemeCardPreview palette={palette} />
                <div className="themes-tab-card-meta">
                  <span className="themes-tab-card-name">{t.name}</span>
                  <span className="themes-tab-card-badge muted small">
                    {row.source === 'bundled' ? 'Bundled' : 'Vault'}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {contextMenu ? (
        <div
          className="themes-tab-context-menu"
          style={{left: contextMenu.x, top: contextMenu.y}}
          role="menu"
          onClick={e => e.stopPropagation()}>
          {contextMenu.theme.source === 'bundled' ? (
            <button type="button" role="menuitem" onClick={() => openExportDialog(contextMenu.theme)}>
              Export to vault…
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={() => void revealThemeFile(contextMenu.theme)}>
              Reveal in file manager
            </button>
          )}
        </div>
      ) : null}

      {exportDialog ? (
        <div className="themes-tab-modal-backdrop" role="presentation" onClick={() => setExportDialog(null)}>
          <div
            className="themes-tab-modal"
            role="dialog"
            aria-modal
            aria-labelledby="themes-export-title"
            onClick={e => e.stopPropagation()}>
            <h3 id="themes-export-title">Export theme</h3>
            <p className="muted small">Display name (file name is derived as kebab-case).</p>
            <label className="field">
              Name
              <input
                value={exportName}
                onChange={e => {
                  setExportName(e.target.value);
                  setExportError(null);
                }}
                autoFocus
              />
            </label>
            {exportError ? (
              <p className="error small" role="alert">
                {exportError}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="primary" onClick={() => void confirmExport()}>
                Export
              </button>
              <button type="button" onClick={() => setExportDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
