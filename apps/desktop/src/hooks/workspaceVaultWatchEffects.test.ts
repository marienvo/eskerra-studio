import {describe, expect, it} from 'vitest';

import {
  normalizeVaultWatchErrorReason,
  vaultChangedPathsSignature,
  vaultWatchBackendFromReason,
} from './workspaceVaultWatchEffects';

describe('workspaceVaultWatchEffects', () => {
  it('re-exports vault watch observability helpers', () => {
    expect(
      vaultChangedPathsSignature(['/vault/A.md', '/vault/B.md']),
    ).toBe('/vault/A.md\n/vault/B.md');
    expect(vaultWatchBackendFromReason('notify_error:poll:x')).toBe('poll');
    expect(normalizeVaultWatchErrorReason('permission denied')).toBe(
      'permission_denied',
    );
  });
});
