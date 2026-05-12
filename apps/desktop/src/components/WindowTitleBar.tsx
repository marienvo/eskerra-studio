import type {WindowTilingState} from '../lib/windowTiling';
import {useEffect, useState, type MouseEvent} from 'react';
import {
  closeDesktopMainWindow,
  isDesktopTauriHost,
  minimizeDesktopMainWindow,
} from '../lib/desktopTauriWindow';
import {
  TodayHubWorkspaceSelect,
  type TodayHubWorkspaceSelectItem,
} from './TodayHubWorkspaceSelect';

export type WindowTitleBarTodayHubSelect =
  | {
      items: readonly TodayHubWorkspaceSelectItem[];
      activeTodayNoteUri: string | null;
      activeLabel: string;
      subLabel?: string;
      /** Match title bar editor tab pill active styling on the workspace main control. */
      mainShowsActiveTabPill?: boolean;
      onMainActivate: () => void;
      onPickHub: (todayNoteUri: string) => void;
      /** Dropdown rows: middle-click opens that hub in a new foreground tab. */
      onOpenHubInNewTab: (todayNoteUri: string) => void;
      /** Main workspace button: middle-click opens Home current page as a background tab. */
      onOpenMainWorkspaceInNewTab: () => void;
    }
  | null
  | undefined;

type WindowTitleBarProps = {
  tiling?: WindowTilingState;
  /** Mount point for editor open-note tabs (React portal target). */
  onEditorTabsHostRef?: (el: HTMLDivElement | null) => void;
  todayHubSelect?: WindowTitleBarTodayHubSelect;
  closeSyncing?: boolean;
  onCloseRequest?: (input: {instant: boolean}) => void;
};

export function WindowTitleBar({
  tiling = 'none',
  onEditorTabsHostRef,
  todayHubSelect = null,
  closeSyncing = false,
  onCloseRequest,
}: WindowTitleBarProps) {
  const tauri = isDesktopTauriHost();
  const [shiftHeld, setShiftHeld] = useState(false);

  const onMinimize = () => {
    minimizeDesktopMainWindow();
  };

  const onClose = (event: MouseEvent<HTMLButtonElement>) => {
    const instant = event.shiftKey || shiftHeld;
    if (onCloseRequest != null) {
      onCloseRequest({instant});
      return;
    }
    closeDesktopMainWindow();
  };

  useEffect(() => {
    if (!tauri) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setShiftHeld(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setShiftHeld(false);
      }
    };
    const onBlur = () => {
      setShiftHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [tauri]);

  const closeLabel = shiftHeld ? 'Close instantly' : closeSyncing ? 'Syncing before close' : 'Sync and close';

  return (
    <header className="window-title-bar" data-window-tiling={tiling}>
      <div
        className="window-title-bar-leading"
        {...(tauri ? {'data-tauri-drag-region': true} : {})}
      >
        {todayHubSelect != null && todayHubSelect.items.length > 0 ? (
          <TodayHubWorkspaceSelect
            items={todayHubSelect.items}
            activeTodayNoteUri={todayHubSelect.activeTodayNoteUri}
            activeLabel={todayHubSelect.activeLabel}
            subLabel={todayHubSelect.subLabel}
            mainShowsActiveTabPill={todayHubSelect.mainShowsActiveTabPill ?? false}
            onMainActivate={todayHubSelect.onMainActivate}
            onPickHub={todayHubSelect.onPickHub}
            onOpenHubInNewTab={todayHubSelect.onOpenHubInNewTab}
            onOpenMainWorkspaceInNewTab={todayHubSelect.onOpenMainWorkspaceInNewTab}
          />
        ) : null}
      </div>
      <div
        ref={onEditorTabsHostRef}
        className="window-title-editor-tabs-host"
        {...(tauri ? {'data-tauri-drag-region': true} : {})}
      />
      <div
        className="window-title-bar-drag-sliver"
        aria-hidden
        {...(tauri ? {'data-tauri-drag-region': true} : {})}
      />
      <div className="window-title-bar-trailing">
        {tauri ? (
          <div className="window-title-bar-controls" role="group" aria-label="Window">
            <button
              type="button"
              className="window-ctrl app-tooltip-trigger window-ctrl-minimize"
              aria-label="Minimize"
              data-tooltip="Minimize"
              data-tooltip-placement="inline-start"
              onClick={onMinimize}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <rect x="3" y="7.5" width="10" height="1.5" rx="0.5" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="window-ctrl app-tooltip-trigger window-ctrl-close"
              aria-label={closeLabel}
              data-tooltip={closeLabel}
              data-tooltip-placement="inline-start"
              onClick={onClose}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M4.35 4.35a.75.75 0 0 1 1.06 0L8 6.94l2.59-2.59a.75.75 0 1 1 1.06 1.06L9.06 8l2.59 2.59a.75.75 0 1 1-1.06 1.06L8 9.06l-2.59 2.59a.75.75 0 0 1-1.06-1.06L6.94 8 4.35 5.41a.75.75 0 0 1 0-1.06Z"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
