import {describe, expect, it} from 'vitest';

import {buildManualGitSyncConfig, GIT_SYNC_REMOTE} from './gitSyncConfig';

describe('buildManualGitSyncConfig', () => {
  it('uses the selected branch', () => {
    expect(buildManualGitSyncConfig('feature/sync').branch).toBe('feature/sync');
  });

  it('keeps the temporary remote hardcoded to origin', () => {
    expect(GIT_SYNC_REMOTE).toBe('origin');
    expect(buildManualGitSyncConfig('main').remote).toBe('origin');
  });
});
