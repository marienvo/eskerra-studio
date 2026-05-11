import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import type {GitStatusResult} from '../lib/tauriVaultGitSync';
import {GitStatusChip} from './GitStatusChip';

const cleanStatus: GitStatusResult = {
  branch: 'main',
  expectedBranch: 'main',
  hasUncommittedChanges: false,
  hasStagedChanges: false,
  hasUntrackedFiles: false,
  ahead: 0,
  behind: 0,
  remoteRefAvailable: true,
  unsafeState: null,
  isWrongBranch: false,
};

describe('GitStatusChip', () => {
  it('renders nothing when status is null', () => {
    const {container} = render(<GitStatusChip status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders loading state', () => {
    render(<GitStatusChip status={null} loading />);
    expect(screen.getByText('Checking…')).toBeInstanceOf(HTMLElement);
  });

  it('renders error state when error is provided', () => {
    render(<GitStatusChip status={null} error="Connection refused" />);
    expect(screen.getByText('Sync error')).toBeInstanceOf(HTMLElement);
    const chip = screen.getByText('Sync error').closest('span');
    expect(chip?.getAttribute('data-tooltip')).toBe('Connection refused');
  });

  it('renders Synced label for a clean status', () => {
    render(<GitStatusChip status={cleanStatus} />);
    expect(screen.getByText('Synced')).toBeInstanceOf(HTMLElement);
  });

  it('renders correct tone class for Synced', () => {
    render(<GitStatusChip status={cleanStatus} />);
    const chip = screen.getByText('Synced').closest('span');
    expect(chip?.className).toContain('git-status-chip--success');
  });

  it('renders Not pushed label when ahead', () => {
    render(<GitStatusChip status={{...cleanStatus, ahead: 2}} />);
    expect(screen.getByText('Not pushed')).toBeInstanceOf(HTMLElement);
  });

  it('renders warning tone for Not pushed', () => {
    render(<GitStatusChip status={{...cleanStatus, ahead: 2}} />);
    const chip = screen.getByText('Not pushed').closest('span');
    expect(chip?.className).toContain('git-status-chip--warning');
  });

  it('renders unsafe state with danger tone', () => {
    render(<GitStatusChip status={{...cleanStatus, unsafeState: 'merge'}} />);
    const chip = screen.getByText('Git needs attention').closest('span');
    expect(chip?.className).toContain('git-status-chip--danger');
  });

  it('sets tooltip from description', () => {
    render(<GitStatusChip status={{...cleanStatus, behind: 3}} />);
    const chip = screen.getByText('Remote changes').closest('span');
    expect(chip?.getAttribute('data-tooltip')).toContain('3 remote commit');
  });

  it('does not set tooltip for Synced (no description)', () => {
    render(<GitStatusChip status={cleanStatus} />);
    const chip = screen.getByText('Synced').closest('span');
    expect(chip?.getAttribute('data-tooltip')).toBeNull();
  });

  it('aria-label includes description when present', () => {
    render(<GitStatusChip status={{...cleanStatus, ahead: 1}} />);
    const chip = screen.getByText('Not pushed').closest('span');
    expect(chip?.getAttribute('aria-label')).toContain('Not pushed');
    expect(chip?.getAttribute('aria-label')).toContain('1 local commit');
  });
});
