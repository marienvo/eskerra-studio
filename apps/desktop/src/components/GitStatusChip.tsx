import {IconGlyph} from '@eskerra/ds-desktop';

import './GitStatusChip.css';

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {mapGitStatusToView} from '../lib/gitStatusView';

type GitStatusChipProps = {
  status: GitStatusResult | null;
  loading?: boolean;
  error?: string | null;
  syncing?: boolean;
};

export function GitStatusChip({
  status,
  loading = false,
  error = null,
  syncing = false,
}: GitStatusChipProps) {
  if (syncing) {
    return (
      <span
        className="git-status-chip git-status-chip--info"
        aria-label="Syncing vault"
        data-tooltip="Syncing vault"
        data-tooltip-placement="inline-start"
      >
        <IconGlyph name="sync" size={12} aria-hidden />
        Syncing…
      </span>
    );
  }

  if (loading) {
    return (
      <span className="git-status-chip git-status-chip--muted" aria-label="Checking sync status">
        <IconGlyph name="sync" size={12} aria-hidden />
        Checking…
      </span>
    );
  }

  if (error != null) {
    return (
      <span
        className="git-status-chip git-status-chip--danger"
        aria-label={`Git status error: ${error}`}
        data-tooltip={error}
        data-tooltip-placement="inline-start"
      >
        <IconGlyph name="error_outline" size={12} aria-hidden />
        Git status error
      </span>
    );
  }

  if (status == null) {
    return null;
  }

  const view = mapGitStatusToView(status);

  return (
    <span
      className={`git-status-chip git-status-chip--${view.tone}`}
      aria-label={view.description != null ? `${view.label}: ${view.description}` : view.label}
      data-tooltip={view.description ?? undefined}
      data-tooltip-placement="inline-start"
    >
      <IconGlyph name={view.icon} size={12} aria-hidden />
      {view.label}
    </span>
  );
}
