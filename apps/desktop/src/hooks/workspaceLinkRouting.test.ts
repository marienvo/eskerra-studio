import {describe, expect, it} from 'vitest';

import {getGeneralDirectoryUri, getInboxDirectoryUri} from '@eskerra/core';

import {
  canonicalWikiPathReplacementInner,
  pickLinkReplacementSurface,
  pickVaultLinkFallbackSource,
} from './workspaceLinkRouting';

describe('workspaceLinkRouting', () => {
  describe('pickVaultLinkFallbackSource', () => {
    const base = '/vault';

    it('uses Inbox while composing a new entry', () => {
      expect(
        pickVaultLinkFallbackSource({
          base,
          composingNewEntry: true,
          showTodayHubCanvas: false,
          todayHubWikiNavParent: '/vault/General/Parent.md',
          selectedUri: '/vault/Inbox/Selected.md',
        }),
      ).toBe(getInboxDirectoryUri(base));
    });

    it('uses General while the Today Hub canvas is active', () => {
      expect(
        pickVaultLinkFallbackSource({
          base,
          composingNewEntry: false,
          showTodayHubCanvas: true,
          todayHubWikiNavParent: '/vault/General/Parent.md',
          selectedUri: '/vault/Inbox/Selected.md',
        }),
      ).toBe(getGeneralDirectoryUri(base));
    });

    it('prefers Today Hub parent, then selected URI, then Inbox fallback', () => {
      expect(
        pickVaultLinkFallbackSource({
          base,
          composingNewEntry: false,
          showTodayHubCanvas: false,
          todayHubWikiNavParent: '/vault/General/Parent.md',
          selectedUri: '/vault/Inbox/Selected.md',
        }),
      ).toBe('/vault/General/Parent.md');

      expect(
        pickVaultLinkFallbackSource({
          base,
          composingNewEntry: false,
          showTodayHubCanvas: false,
          todayHubWikiNavParent: null,
          selectedUri: '/vault/Inbox/Selected.md',
        }),
      ).toBe('/vault/Inbox/Selected.md');

      expect(
        pickVaultLinkFallbackSource({
          base,
          composingNewEntry: false,
          showTodayHubCanvas: false,
          todayHubWikiNavParent: null,
          selectedUri: null,
        }),
      ).toBe(getInboxDirectoryUri(base));
    });
  });

  describe('canonicalWikiPathReplacementInner', () => {
    it('preserves aliases while replacing the canonical wiki path', () => {
      expect(
        canonicalWikiPathReplacementInner('Daily/Today|today', 'Daily/Today.md'),
      ).toBe('Daily/Today.md|today');
    });

    it('replaces the full inner text when there is no alias', () => {
      expect(canonicalWikiPathReplacementInner('Daily/Today', 'Daily/Today.md')).toBe(
        'Daily/Today.md',
      );
    });
  });

  describe('pickLinkReplacementSurface', () => {
    it('uses the Today Hub cell only when both editor and navigation parent exist', () => {
      expect(
        pickLinkReplacementSurface({
          hasTodayHubCellEditor: true,
          todayHubWikiNavParent: '/vault/General/Today.md',
        }),
      ).toBe('todayHubCell');

      expect(
        pickLinkReplacementSurface({
          hasTodayHubCellEditor: true,
          todayHubWikiNavParent: null,
        }),
      ).toBe('inbox');

      expect(
        pickLinkReplacementSurface({
          hasTodayHubCellEditor: false,
          todayHubWikiNavParent: '/vault/General/Today.md',
        }),
      ).toBe('inbox');
    });
  });
});
