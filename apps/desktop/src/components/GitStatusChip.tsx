import {IconGlyph} from '@eskerra/ds-desktop';

import './GitStatusChip.css';

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {mapGitStatusToView} from '../lib/gitStatusView';
import type {TransientGitStatus} from '../hooks/useGitSyncTransientStatus';

type GitStatusChipProps = {
  status: GitStatusResult | null;
  loading?: boolean;
  error?: string | null;
  syncing?: boolean;
  transient?: TransientGitStatus | null;
  /** Replaces "Local changes" label when autosync countdown is active. */
  autosyncCountdownLabel?: string | null;
};

export function GitStatusChip({
  status,
  loading = false,
  error = null,
  syncing = false,
  transient = null,
  autosyncCountdownLabel = null,
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

  if (transient != null) {
    return (
      <span
        className={`git-status-chip git-status-chip--${transient.tone}`}
        aria-label={
          transient.description != null
            ? `${transient.label}: ${transient.description}`
            : transient.label
        }
        data-tooltip={transient.description ?? undefined}
        data-tooltip-placement="inline-start"
      >
        <IconGlyph name={transient.icon} size={12} aria-hidden />
        {transient.label}
      </span>
    );
  }

  if (status == null) {
    return null;
  }

  const view = mapGitStatusToView(status);
  const useAutosyncCountdown =
    autosyncCountdownLabel != null && view.label === 'Local changes';
  const displayLabel = useAutosyncCountdown ? autosyncCountdownLabel : view.label;
  let ariaLabel = view.label;
  if (useAutosyncCountdown) {
    ariaLabel =
      view.description != null ? `${displayLabel}: ${view.description}` : displayLabel;
  } else if (view.description != null) {
    ariaLabel = `${view.label}: ${view.description}`;
  }

  return (
    <span
      className={`git-status-chip git-status-chip--${view.tone}`}
      aria-label={ariaLabel}
      data-tooltip={view.description ?? undefined}
      data-tooltip-placement="inline-start"
    >
      <IconGlyph name={view.icon} size={12} aria-hidden />
      {useAutosyncCountdown ? (
        <>
          Syncs in{' '}
          <span className="git-status-chip__countdown-time">
            {autosyncCountdownLabel.replace(/^Syncs in\s+/, '')}
          </span>
        </>
      ) : (
        displayLabel
      )}
    </span>
  );
}
