import type {GitStatusResult, GitStatusUnsafeState} from './tauriVaultGitSync';

export type GitStatusTone = 'danger' | 'warning' | 'info' | 'success' | 'muted';

export interface GitStatusView {
  label: string;
  tone: GitStatusTone;
  /** Shown in tooltip. Null when label is self-explanatory. */
  description: string | null;
  /** Material Icons ligature name. */
  icon: string;
}

/**
 * Map a GitStatusResult to display state.
 *
 * Priority order (first match wins):
 *   1. Unsafe state (merge/rebase/cherry-pick/detached HEAD/index.lock/…)
 *   2. Wrong branch
 *   3. Diverged (ahead > 0 && behind > 0)
 *   4. Not pushed (ahead > 0)
 *   5. Remote changes (behind > 0)
 *   6. Local changes (staged || uncommitted || untracked)
 *   7. Remote unknown (remoteRefAvailable false)
 *   8. Synced
 */
export function mapGitStatusToView(status: GitStatusResult): GitStatusView {
  if (status.unsafeState != null) {
    return {
      label: 'Git needs attention',
      tone: 'danger',
      description: describeUnsafeState(status.unsafeState),
      icon: 'error_outline',
    };
  }

  if (status.isWrongBranch) {
    const current = status.branch ?? 'detached HEAD';
    return {
      label: 'Wrong branch',
      tone: 'warning',
      description: `On "${current}", expected "${status.expectedBranch}"`,
      icon: 'alt_route',
    };
  }

  if (status.ahead > 0 && status.behind > 0) {
    return {
      label: 'Diverged',
      tone: 'warning',
      description: `${status.ahead} local commit${pluralSuffix(status.ahead)}, ${status.behind} remote commit${pluralSuffix(status.behind)}`,
      icon: 'swap_vert',
    };
  }

  if (status.ahead > 0) {
    return {
      label: 'Not pushed',
      tone: 'warning',
      description: `${status.ahead} local commit${pluralSuffix(status.ahead)} not pushed`,
      icon: 'arrow_upward',
    };
  }

  if (status.behind > 0) {
    return {
      label: 'Remote changes',
      tone: 'info',
      description: `${status.behind} remote commit${pluralSuffix(status.behind)} available`,
      icon: 'arrow_downward',
    };
  }

  if (status.hasStagedChanges || status.hasUncommittedChanges || status.hasUntrackedFiles) {
    return {
      label: 'Local changes',
      tone: 'info',
      description: describeLocalChanges(status),
      icon: 'edit',
    };
  }

  if (!status.remoteRefAvailable) {
    return {
      label: 'Remote unknown',
      tone: 'muted',
      description: 'Remote tracking ref not found locally',
      icon: 'cloud_off',
    };
  }

  return {
    label: 'Synced',
    tone: 'success',
    description: null,
    icon: 'check_circle',
  };
}

function pluralSuffix(count: number): string {
  return count === 1 ? '' : 's';
}

function describeUnsafeState(state: GitStatusUnsafeState): string {
  switch (state) {
    case 'detachedHead':
      return 'HEAD is detached — not on a branch';
    case 'merge':
      return 'Merge in progress';
    case 'rebase':
      return 'Rebase in progress';
    case 'cherryPick':
      return 'Cherry-pick in progress';
    case 'revert':
      return 'Revert in progress';
    case 'bisect':
      return 'Bisect in progress';
    case 'indexLock':
      return 'Git index is locked — another process may be running';
    default: {
      const _exhaustive: never = state;
      return `Git operation in progress (${_exhaustive})`;
    }
  }
}

function describeLocalChanges(status: GitStatusResult): string {
  const parts: string[] = [];
  if (status.hasStagedChanges) parts.push('staged changes');
  if (status.hasUncommittedChanges) parts.push('unstaged changes');
  if (status.hasUntrackedFiles) parts.push('untracked files');
  return parts.join(', ');
}
