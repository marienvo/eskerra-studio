import {describe, expect, it} from 'vitest';

import {
  isActiveWorkspaceTodayLinkSurface,
  selectNoteActiveHubTodayOpen,
  shouldOpenActiveHubTodayAsHome,
  workspaceSelectShowsActiveTabPillState,
  workspaceSelectorMainShowsActiveTabPill,
  workspaceSelectorSubLabelText,
} from './workspaceShellToday';
import {createEditorWorkspaceTab, tabCurrentUri} from './editorWorkspaceTabs';
import {createWorkspaceHomeState} from './workspaceHomeNavigation';

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

describe('workspaceSelectorSubLabelText', () => {
  it('is undefined when Home history is at hub Today', () => {
    const hub = '/vault/Daily/Today.md';
    expect(
      workspaceSelectorSubLabelText({
        activeTodayHubUri: hub,
        homeState: createWorkspaceHomeState(hub),
      }),
    ).toBeUndefined();
  });

  it('uses home current note title when history index > 0 (persists across tab surface)', () => {
    const hub = '/vault/Daily/Today.md';
    const sub = '/vault/Inbox/Nested.md';
    expect(
      workspaceSelectorSubLabelText({
        activeTodayHubUri: hub,
        homeState: {history: {entries: [hub, sub], index: 1}},
      }),
    ).toBe('Nested');
  });
});

describe('workspaceSelectorMainShowsActiveTabPill', () => {
  it('is true only on Home surface when history index > 0', () => {
    const hub = '/vault/Daily/Today.md';
    expect(
      workspaceSelectorMainShowsActiveTabPill({
        composingNewEntry: false,
        activeTodayHubUri: hub,
        activeEditorTabId: null,
        homeState: {history: {entries: [hub, '/vault/Other.md'], index: 1}},
      }),
    ).toBe(true);
  });

  it('is false when an editor tab is active, even if Home has a sub-page', () => {
    const hub = '/vault/Daily/Today.md';
    expect(
      workspaceSelectorMainShowsActiveTabPill({
        composingNewEntry: false,
        activeTodayHubUri: hub,
        activeEditorTabId: 'tab-1',
        homeState: {history: {entries: [hub, '/vault/Other.md'], index: 1}},
      }),
    ).toBe(false);
  });

  it('is false on Home root (index 0)', () => {
    const hub = '/vault/Daily/Today.md';
    expect(
      workspaceSelectorMainShowsActiveTabPill({
        composingNewEntry: false,
        activeTodayHubUri: hub,
        activeEditorTabId: null,
        homeState: createWorkspaceHomeState(hub),
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
