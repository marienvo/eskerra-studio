import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {NEW_FILE_MAX_LINES} from './check-module-budgets.mjs';
import {buildUpdatedMaxLinesByPath} from './update-module-budget-baseline.mjs';

describe('buildUpdatedMaxLinesByPath', () => {
  it('removes existing baseline entries that no longer exceed the new-file threshold', () => {
    const next = buildUpdatedMaxLinesByPath(
      {
        'apps/desktop/src/lib/tiny.ts': 1006,
        'apps/desktop/src/lib/still-large.ts': 1006,
      },
      {
        pathExists: () => true,
        countLinesForPath: rel =>
          rel.endsWith('tiny.ts') ? NEW_FILE_MAX_LINES : NEW_FILE_MAX_LINES + 1,
      },
    );

    assert.deepEqual(next, {
      'apps/desktop/src/lib/still-large.ts': NEW_FILE_MAX_LINES + 1,
    });
  });

  it('ignores auto additions that do not exceed the new-file threshold', () => {
    const next = buildUpdatedMaxLinesByPath(
      {},
      {
        pathExists: () => false,
        countLinesForPath: () => 0,
        autoBaselineAdditions: {
          'apps/desktop/src/lib/tiny-new.ts': NEW_FILE_MAX_LINES,
          'apps/desktop/src/lib/large-new.ts': NEW_FILE_MAX_LINES + 1,
        },
      },
    );

    assert.deepEqual(next, {
      'apps/desktop/src/lib/large-new.ts': NEW_FILE_MAX_LINES + 1,
    });
  });

  it('removes baseline entries when the file no longer exists on disk', () => {
    const next = buildUpdatedMaxLinesByPath(
      {
        'apps/desktop/src/lib/removed-from-repo.ts': 1006,
      },
      {
        pathExists: () => false,
        countLinesForPath: () => {
          assert.fail('countLinesForPath should not run after pathExists is false');
        },
      },
    );

    assert.deepEqual(next, {});
  });
});
