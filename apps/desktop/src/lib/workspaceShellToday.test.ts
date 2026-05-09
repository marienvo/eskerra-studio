import {describe, expect, it} from 'vitest';

import {
  isActiveWorkspaceTodayLinkSurface,
  selectNoteActiveHubTodayOpen,
  shouldOpenActiveHubTodayAsHome,
  workspaceSelectShowsActiveTabPillState,
} from './workspaceShellToday';
import {createEditorWorkspaceTab, tabCurrentUri} from './editorWorkspaceTabs';

describe('selectNoteActiveHubTodayOpen', () => {
  it('returns home for the active hub Today regardless of tab count', () => {
    expect(
      selectNoteActiveHubTodayOpen({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Daily/Today.md',
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 0,
      }),
    ).toBe('home');
    expect(
      selectNoteActiveHubTodayOpen({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Daily/Today.md',
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 2,
      }),
    ).toBe('home');
    expect(
      selectNoteActiveHubTodayOpen({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Other/Today.md',
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 1,
      }),
    ).toBe(null);
  });
});

describe('shouldOpenActiveHubTodayAsHome', () => {
  it('is true only with active hub and Today file', () => {
    expect(
      shouldOpenActiveHubTodayAsHome({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Daily/Today.md',
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldOpenActiveHubTodayAsHome({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Daily/Today.md',
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldOpenActiveHubTodayAsHome({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Other/Today.md',
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldOpenActiveHubTodayAsHome({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: '/vault/Daily/Today.md',
        uriIsTodayMarkdownFile: false,
        editorWorkspaceTabCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldOpenActiveHubTodayAsHome({
        uri: '/vault/Daily/Today.md',
        activeTodayHubUri: null,
        uriIsTodayMarkdownFile: true,
        editorWorkspaceTabCount: 0,
      }),
    ).toBe(false);
  });
});

describe('workspaceSelectShowsActiveTabPillState', () => {
  it('is true when Today matches hub and no tab shows that URI', () => {
    const other = createEditorWorkspaceTab('/vault/Note.md');
    expect(
      workspaceSelectShowsActiveTabPillState({
        composingNewEntry: false,
        activeTodayHubUri: '/vault/Daily/Today.md',
        selectedUri: '/vault/Daily/Today.md',
        editorWorkspaceTabs: [other],
      }),
    ).toBe(true);
  });

  it('is false when a tab already shows the hub Today', () => {
    const todayTab = createEditorWorkspaceTab('/vault/Daily/Today.md');
    expect(
      workspaceSelectShowsActiveTabPillState({
        composingNewEntry: false,
        activeTodayHubUri: '/vault/Daily/Today.md',
        selectedUri: '/vault/Daily/Today.md',
        editorWorkspaceTabs: [todayTab],
      }),
    ).toBe(false);
    expect(tabCurrentUri(todayTab)).toBe('/vault/Daily/Today.md');
  });

  it('is false while composing', () => {
    expect(
      workspaceSelectShowsActiveTabPillState({
        composingNewEntry: true,
        activeTodayHubUri: '/vault/Daily/Today.md',
        selectedUri: '/vault/Daily/Today.md',
        editorWorkspaceTabs: [],
      }),
    ).toBe(false);
  });
});

describe('isActiveWorkspaceTodayLinkSurface', () => {
  it('detects workspace Home while no editor tab is active', () => {
    expect(
      isActiveWorkspaceTodayLinkSurface({
        composingNewEntry: false,
        activeTodayHubUri: '/vault/Daily/Today.md',
        selectedUri: '/vault/Daily/Today.md',
        activeEditorTabId: null,
      }),
    ).toBe(true);
    expect(
      isActiveWorkspaceTodayLinkSurface({
        composingNewEntry: false,
        activeTodayHubUri: '/vault/Daily/Today.md',
        selectedUri: '/vault/Other.md',
        activeEditorTabId: null,
      }),
    ).toBe(true);
    expect(
      isActiveWorkspaceTodayLinkSurface({
        composingNewEntry: false,
        activeTodayHubUri: '/vault/Daily/Today.md',
        selectedUri: '/vault/Other.md',
        activeEditorTabId: 'tab-1',
      }),
    ).toBe(false);
  });
});
