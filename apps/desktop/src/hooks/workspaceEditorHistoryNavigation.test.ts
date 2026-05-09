import {describe, expect, it} from 'vitest';

import type {EditorDocumentHistoryState} from '../lib/editorDocumentHistory';
import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {
  createWorkspaceHomeState,
  homeGoBack,
  pushHomeNavigate,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import {
  computeEditorHistoryCanGoBack,
  computeEditorHistoryCanGoForward,
  deriveActiveHomeStateSnapshot,
  deriveActiveTabHistorySnapshot,
} from './workspaceEditorHistoryNavigation';

function tabWithHistory(
  id: string,
  history: EditorDocumentHistoryState,
): EditorWorkspaceTab {
  return {id, history};
}

describe('workspaceEditorHistoryNavigation', () => {
  describe('deriveActiveTabHistorySnapshot', () => {
    it('returns empty history when no active tab', () => {
      expect(
        deriveActiveTabHistorySnapshot({
          activeEditorTabId: null,
          editorWorkspaceTabs: [],
        }),
      ).toEqual({entries: [], index: -1});
    });

    it('returns tab history when tab exists', () => {
      const h: EditorDocumentHistoryState = {
        entries: ['u1', 'u2'],
        index: 1,
      };
      expect(
        deriveActiveTabHistorySnapshot({
          activeEditorTabId: 'a',
          editorWorkspaceTabs: [tabWithHistory('a', h)],
        }),
      ).toEqual(h);
    });
  });

  describe('deriveActiveHomeStateSnapshot', () => {
    const hub = 'content://vault/Inbox/Today.md';

    it('returns null when a tab is active', () => {
      expect(
        deriveActiveHomeStateSnapshot({
          activeEditorTabId: 'x',
          activeTodayHubUri: hub,
          homeStatesByHub: {},
        }),
      ).toBeNull();
    });

    it('returns null when no hub', () => {
      expect(
        deriveActiveHomeStateSnapshot({
          activeEditorTabId: null,
          activeTodayHubUri: null,
          homeStatesByHub: {},
        }),
      ).toBeNull();
    });

    it('returns persisted hub state or default', () => {
      const custom = pushHomeNavigate(createWorkspaceHomeState(hub), hub);
      expect(
        deriveActiveHomeStateSnapshot({
          activeEditorTabId: null,
          activeTodayHubUri: hub,
          homeStatesByHub: {[hub]: custom},
        }),
      ).toEqual(custom);

      expect(
        deriveActiveHomeStateSnapshot({
          activeEditorTabId: null,
          activeTodayHubUri: hub,
          homeStatesByHub: {},
        }),
      ).toEqual(createWorkspaceHomeState(hub));
    });
  });

  describe('computeEditorHistoryCanGoBack', () => {
    const emptyTab: EditorDocumentHistoryState = {entries: [], index: -1};

    it('home: composing uses current uri presence', () => {
      const emptyHistory: WorkspaceHomeState = {
        history: {entries: [], index: -1},
      };
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: true,
          activeHomeState: emptyHistory,
          activeTabHistory: emptyTab,
        }),
      ).toBe(false);

      const hub = 'content://vault/Inbox/Today.md';
      const navigated = pushHomeNavigate(
        createWorkspaceHomeState(hub),
        'content://vault/Inbox/Note.md',
      );
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: true,
          activeHomeState: navigated,
          activeTabHistory: emptyTab,
        }),
      ).toBe(true);
    });

    it('home: normal uses homeCanGoBack', () => {
      const hub = 'content://vault/Inbox/Today.md';
      const state = pushHomeNavigate(
        createWorkspaceHomeState(hub),
        'content://vault/Inbox/Note.md',
      );
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: false,
          activeHomeState: state,
          activeTabHistory: emptyTab,
        }),
      ).toBe(true);
    });

    it('tab: composing requires index >= 0', () => {
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: true,
          activeHomeState: null,
          activeTabHistory: {entries: ['a'], index: -1},
        }),
      ).toBe(false);
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: true,
          activeHomeState: null,
          activeTabHistory: {entries: ['a', 'b'], index: 1},
        }),
      ).toBe(true);
    });

    it('tab: normal requires index > 0', () => {
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: false,
          activeHomeState: null,
          activeTabHistory: {entries: ['a'], index: 0},
        }),
      ).toBe(false);
      expect(
        computeEditorHistoryCanGoBack({
          composingNewEntry: false,
          activeHomeState: null,
          activeTabHistory: {entries: ['a', 'b'], index: 1},
        }),
      ).toBe(true);
    });
  });

  describe('computeEditorHistoryCanGoForward', () => {
    const emptyHome = null;

    it('home: requires not busy and not composing', () => {
      const hub = 'content://vault/Inbox/Today.md';
      let s = createWorkspaceHomeState(hub);
      s = pushHomeNavigate(s, 'content://vault/Inbox/Other.md');
      s = homeGoBack(s);

      expect(
        computeEditorHistoryCanGoForward({
          busy: false,
          composingNewEntry: false,
          activeHomeState: s,
          activeTabHistory: {entries: [], index: -1},
        }),
      ).toBe(true);

      expect(
        computeEditorHistoryCanGoForward({
          busy: true,
          composingNewEntry: false,
          activeHomeState: s,
          activeTabHistory: {entries: [], index: -1},
        }),
      ).toBe(false);
    });

    it('tab: blocked when busy or composing', () => {
      const hist: EditorDocumentHistoryState = {
        entries: ['a', 'b'],
        index: 0,
      };
      expect(
        computeEditorHistoryCanGoForward({
          busy: true,
          composingNewEntry: false,
          activeHomeState: emptyHome,
          activeTabHistory: hist,
        }),
      ).toBe(false);
      expect(
        computeEditorHistoryCanGoForward({
          busy: false,
          composingNewEntry: true,
          activeHomeState: emptyHome,
          activeTabHistory: hist,
        }),
      ).toBe(false);
    });

    it('tab: true when index between bounds', () => {
      expect(
        computeEditorHistoryCanGoForward({
          busy: false,
          composingNewEntry: false,
          activeHomeState: emptyHome,
          activeTabHistory: {entries: ['a', 'b'], index: 0},
        }),
      ).toBe(true);
      expect(
        computeEditorHistoryCanGoForward({
          busy: false,
          composingNewEntry: false,
          activeHomeState: emptyHome,
          activeTabHistory: {entries: ['a', 'b'], index: 1},
        }),
      ).toBe(false);
    });
  });
});
