import {describe, expect, it} from 'vitest';

import {
  DEFAULT_LAYOUTS,
  INBOX_LEFT_PANEL,
  NOTIFICATIONS_INBOX_STACK_TOP,
  NOTIFICATIONS_PANEL,
  VAULT_EPISODES_STACK_TOP,
  migrateV3LayoutsToV4,
  parseLayoutPanelsV4ForTest,
} from './layoutStore';

describe('parseLayoutPanelsV4ForTest', () => {
  it('maps legacy editorInboxStack to notificationsInboxStack', () => {
    const out = parseLayoutPanelsV4ForTest({
      inbox: {leftWidthPx: 280},
      podcastsMain: {leftWidthPx: 280},
      notifications: {widthPx: 280},
      vaultEpisodesStack: {topHeightPx: 200},
      editorInboxStack: {topHeightPx: 400},
    });
    expect(out).not.toBeNull();
    expect(out!.notificationsInboxStack.topHeightPx).toBe(400);
  });
});

describe('migrateV3LayoutsToV4', () => {
  it('maps v3 percentage left columns to pixel widths using the fixed migration width', () => {
    const migrated = migrateV3LayoutsToV4({
      inbox: {files: 30, editor: 70},
      podcastsMain: {episodes: 38, rightCol: 62},
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.inbox.leftWidthPx).toBe(389);
    expect(migrated!.podcastsMain.leftWidthPx).toBe(389);
    expect(migrated!.vaultEpisodesStack.topHeightPx).toBe(
      VAULT_EPISODES_STACK_TOP.defaultPx,
    );
    expect(migrated!.notificationsInboxStack.topHeightPx).toBe(
      NOTIFICATIONS_INBOX_STACK_TOP.defaultPx,
    );
  });

  it('clamps migrated values into allowed ranges', () => {
    const migrated = migrateV3LayoutsToV4({
      inbox: {files: 5, editor: 95},
      podcastsMain: {episodes: 90, rightCol: 10},
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.inbox.leftWidthPx).toBe(INBOX_LEFT_PANEL.maxPx);
    expect(migrated!.podcastsMain.leftWidthPx).toBe(INBOX_LEFT_PANEL.maxPx);
  });

  it('returns null for invalid payloads', () => {
    expect(migrateV3LayoutsToV4(null)).toBeNull();
    expect(migrateV3LayoutsToV4({})).toBeNull();
    expect(migrateV3LayoutsToV4({inbox: {files: 30}})).toBeNull();
  });
});

describe('DEFAULT_LAYOUTS', () => {
  it('uses documented default pixel widths', () => {
    expect(DEFAULT_LAYOUTS.inbox.leftWidthPx).toBe(INBOX_LEFT_PANEL.defaultPx);
    expect(DEFAULT_LAYOUTS.podcastsMain.leftWidthPx).toBe(INBOX_LEFT_PANEL.defaultPx);
    expect(DEFAULT_LAYOUTS.notifications.widthPx).toBe(NOTIFICATIONS_PANEL.defaultPx);
    expect(DEFAULT_LAYOUTS.vaultEpisodesStack.topHeightPx).toBe(
      VAULT_EPISODES_STACK_TOP.defaultPx,
    );
    expect(DEFAULT_LAYOUTS.notificationsInboxStack.topHeightPx).toBe(
      NOTIFICATIONS_INBOX_STACK_TOP.defaultPx,
    );
  });
});
