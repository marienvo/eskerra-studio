import {describe, expect, it} from 'vitest';

import {
  normalizeVaultWatchErrorReason,
  vaultChangedPathsSignature,
  vaultWatchBackendFromReason,
} from './workspaceVaultWatchEffects';

describe('workspaceVaultWatchEffects', () => {
  it('normalizes changed path batches into a stable signature', () => {
    expect(
      vaultChangedPathsSignature([
        ' /vault/B.md ',
        '',
        '/vault/A.md',
        '/vault/B.md',
      ]),
    ).toBe('/vault/A.md\n/vault/B.md');
  });

  it('extracts watcher backend from coarse reasons', () => {
    expect(vaultWatchBackendFromReason(null)).toBe('unknown');
    expect(vaultWatchBackendFromReason('notify_error:recommended:boom')).toBe(
      'recommended',
    );
    expect(vaultWatchBackendFromReason('notify_error')).toBe('unknown');
  });

  it('normalizes startup watcher errors for observability fingerprints', () => {
    expect(normalizeVaultWatchErrorReason('failed (os error 24)')).toBe(
      'os_error_24',
    );
    expect(normalizeVaultWatchErrorReason('Permission denied')).toBe(
      'permission_denied',
    );
    expect(normalizeVaultWatchErrorReason('No such file or directory')).toBe(
      'not_found',
    );
    expect(normalizeVaultWatchErrorReason('too many open files')).toBe(
      'too_many_open_files',
    );
    expect(normalizeVaultWatchErrorReason('recommended watcher failed')).toBe(
      'recommended_watcher_error',
    );
    expect(normalizeVaultWatchErrorReason('poll watcher failed')).toBe(
      'poll_watcher_error',
    );
    expect(normalizeVaultWatchErrorReason('something else')).toBe('unknown');
  });
});
