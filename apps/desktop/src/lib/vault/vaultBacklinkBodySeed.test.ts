import {describe, expect, it} from 'vitest';

import {mergeVaultBacklinkBodySeed} from './vaultBacklinkBodySeed';

describe('mergeVaultBacklinkBodySeed', () => {
  it('lets inbox content override disk cache for the same uri', () => {
    const merged = mergeVaultBacklinkBodySeed(
      {'file:///a.md': 'from disk'},
      {'file:///a.md': 'from editor'},
    );
    expect(merged['file:///a.md']).toBe('from editor');
  });

  it('keeps disk-only keys and adds inbox-only keys', () => {
    const merged = mergeVaultBacklinkBodySeed(
      {'file:///only-disk.md': 'd'},
      {'file:///only-inbox.md': 'i'},
    );
    expect(merged['file:///only-disk.md']).toBe('d');
    expect(merged['file:///only-inbox.md']).toBe('i');
  });
});
