import {describe, expect, it} from 'vitest';

import {
  buildPendingWikiLinkAmbiguityRename,
  createEmptyVaultWikiLinkRenamePlan,
  shouldShowRenameLinkProgress,
} from './workspaceRenameMaintenance';

describe('workspaceRenameMaintenance', () => {
  it('creates an empty plan when a display name cannot produce a note stem', () => {
    expect(createEmptyVaultWikiLinkRenamePlan(3)).toEqual({
      updates: [],
      scannedFileCount: 3,
      touchedFileCount: 0,
      touchedBytes: 0,
      updatedLinkCount: 0,
      skippedAmbiguousLinkCount: 0,
    });
  });

  it('shows progress only for large non-ambiguous rename plans', () => {
    expect(
      shouldShowRenameLinkProgress({
        skippedAmbiguousLinkCount: 0,
        touchedFileCount: 60,
        touchedBytes: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowRenameLinkProgress({
        skippedAmbiguousLinkCount: 0,
        touchedFileCount: 1,
        touchedBytes: 768 * 1024,
      }),
    ).toBe(true);
    expect(
      shouldShowRenameLinkProgress({
        skippedAmbiguousLinkCount: 1,
        touchedFileCount: 80,
        touchedBytes: 900 * 1024,
      }),
    ).toBe(false);
    expect(
      shouldShowRenameLinkProgress({
        skippedAmbiguousLinkCount: 0,
        touchedFileCount: 0,
        touchedBytes: 900 * 1024,
      }),
    ).toBe(false);
  });

  it('builds the ambiguity prompt payload from the pre-rename plan', () => {
    const pending = buildPendingWikiLinkAmbiguityRename({
      uri: 'vault/Inbox/Old.md',
      nextDisplayName: 'New',
      plan: {
        updates: [{uri: 'vault/Inbox/A.md', markdown: '[[New]]', updatedLinkCount: 1}],
        scannedFileCount: 5,
        touchedFileCount: 1,
        touchedBytes: 12,
        updatedLinkCount: 1,
        skippedAmbiguousLinkCount: 2,
      },
    });
    expect(pending).toEqual({
      uri: 'vault/Inbox/Old.md',
      nextDisplayName: 'New',
      summary: {
        scannedFileCount: 5,
        touchedFileCount: 1,
        touchedBytes: 12,
        updatedLinkCount: 1,
        skippedAmbiguousLinkCount: 2,
      },
    });
  });
});
