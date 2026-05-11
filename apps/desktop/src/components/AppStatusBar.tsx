import type {ReactNode} from 'react';

import {MaterialIcon} from './MaterialIcon';
import './AppStatusBar.css';

/** Shared with {@link AppSetupTagline} and main {@link AppStatusBar}. */
export const APP_SHELL_TAGLINE = 'Think. Compose. Nothing else.';

/** Bottom tagline on vault picker / loading only (no settings control). */
export function AppSetupTagline() {
  return (
    <footer className="app-setup-tagline">
      <p className="app-setup-tagline-text">{APP_SHELL_TAGLINE}</p>
    </footer>
  );
}

type AppStatusBarProps = {
  onOpenSettings: () => void;
  onManualSync?: () => void;
  manualSyncBusy?: boolean;
  manualSyncDisabled?: boolean;
  statusIndicator?: ReactNode;
};

export function AppStatusBar({
  onOpenSettings,
  onManualSync,
  manualSyncBusy = false,
  manualSyncDisabled = false,
  statusIndicator,
}: AppStatusBarProps) {
  return (
    <footer className="app-status-bar">
      <div className="app-status-bar-center-stack">
        <p className="app-status-bar-center-line app-status-bar-center--tagline">
          {APP_SHELL_TAGLINE}
        </p>
      </div>
      <div className="app-status-bar-trailing">
        {statusIndicator}
        {onManualSync ? (
          <button
            type="button"
            className="app-status-bar-icon-tile app-tooltip-trigger icon-btn-ghost"
            aria-label={manualSyncBusy ? 'Syncing vault' : 'Sync vault'}
            data-tooltip={manualSyncBusy ? 'Syncing vault' : 'Sync vault'}
            data-tooltip-placement="inline-start"
            disabled={manualSyncBusy || manualSyncDisabled}
            onClick={onManualSync}
          >
            <MaterialIcon name="sync" size={12} />
          </button>
        ) : null}
        <button
          type="button"
          className="app-status-bar-icon-tile app-tooltip-trigger icon-btn-ghost"
          aria-label="Settings"
          data-tooltip="Settings"
          data-tooltip-placement="inline-start"
          onClick={onOpenSettings}
        >
          <MaterialIcon name="settings" size={12} />
        </button>
      </div>
    </footer>
  );
}
