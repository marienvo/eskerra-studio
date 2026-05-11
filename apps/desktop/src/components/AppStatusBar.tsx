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
  statusIndicator?: ReactNode;
};

export function AppStatusBar({onOpenSettings, statusIndicator}: AppStatusBarProps) {
  return (
    <footer className="app-status-bar">
      <div className="app-status-bar-center-stack">
        <p className="app-status-bar-center-line app-status-bar-center--tagline">
          {APP_SHELL_TAGLINE}
        </p>
      </div>
      <div className="app-status-bar-trailing">
        {statusIndicator}
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
