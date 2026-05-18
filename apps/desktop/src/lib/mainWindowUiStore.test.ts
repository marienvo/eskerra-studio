import {describe, expect, it} from 'vitest';

import {createEditorWorkspaceTab} from './editorWorkspaceTabs';
import {
  buildStoredMainWindowInboxForPersist,
  DEFAULT_MAIN_WINDOW_PANE_VISIBILITY,
  normalizeMainWindowUiPayload,
  type TodayHubWorkspaceSnapshot,
} from './mainWindowUiStore';

describe('normalizeMainWindowUiPayload', () => {
  it('returns null for non-objects', () => {
    expect(normalizeMainWindowUiPayload(null)).toBeNull();
    expect(normalizeMainWindowUiPayload(undefined)).toBeNull();
    expect(normalizeMainWindowUiPayload('x')).toBeNull();
    expect(normalizeMainWindowUiPayload([])).toBeNull();
  });

  it('returns null when vaultRoot is missing or blank', () => {
    expect(normalizeMainWindowUiPayload({})).toBeNull();
    expect(normalizeMainWindowUiPayload({vaultRoot: ''})).toBeNull();
    expect(normalizeMainWindowUiPayload({vaultRoot: '   '})).toBeNull();
    expect(normalizeMainWindowUiPayload({vaultRoot: 1})).toBeNull();
  });

  it('migrates legacy mainTab podcasts to episodes-only panes', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/vault',
      mainTab: 'settings',
    });
    expect(out).toEqual({
      vaultRoot: '/vault',
      vaultPaneVisible: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.vaultPaneVisible,
      episodesPaneVisible: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.episodesPaneVisible,
      inboxPaneVisible: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible,
      notificationsPanelVisible: true,
      inbox: {composingNewEntry: false, selectedUri: null},
    });
  });

  it('migrates legacy mainTab inbox to vault-only panes', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '  /data/v  ',
      mainTab: 'inbox',
    });
    expect(out).toEqual({
      vaultRoot: '/data/v',
      vaultPaneVisible: true,
      episodesPaneVisible: false,
      inboxPaneVisible: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible,
      notificationsPanelVisible: true,
      inbox: {composingNewEntry: false, selectedUri: null},
    });
  });

  it('migrates legacy mainTab podcasts to episodes pane visible', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      mainTab: 'podcasts',
    });
    expect(out).toEqual({
      vaultRoot: '/v',
      vaultPaneVisible: false,
      episodesPaneVisible: true,
      inboxPaneVisible: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible,
      notificationsPanelVisible: true,
      inbox: {composingNewEntry: false, selectedUri: null},
    });
  });

  it('prefers explicit vaultPaneVisible and episodesPaneVisible over mainTab', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      mainTab: 'inbox',
      vaultPaneVisible: false,
      episodesPaneVisible: true,
    });
    expect(out?.vaultPaneVisible).toBe(false);
    expect(out?.episodesPaneVisible).toBe(true);
  });

  it('ignores legacy playerDockVisible in stored JSON', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      mainTab: 'inbox',
      playerDockVisible: false,
    });
    expect(out).toEqual({
      vaultRoot: '/v',
      vaultPaneVisible: true,
      episodesPaneVisible: false,
      inboxPaneVisible: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible,
      notificationsPanelVisible: true,
      inbox: {composingNewEntry: false, selectedUri: null},
    });
  });

  it('parses inboxPaneVisible', () => {
    const hidden = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inboxPaneVisible: false,
    });
    expect(hidden?.inboxPaneVisible).toBe(false);
    const invalid = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inboxPaneVisible: 'yes',
    });
    expect(invalid?.inboxPaneVisible).toBe(DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible);
  });

  it('sanitizes inbox fields', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {
        composingNewEntry: true,
        composeDraftMarkdown: 'Draft body',
        selectedUri: '  /v/Inbox/x.md  ',
      },
    });
    expect(out?.inbox).toEqual({
      composingNewEntry: true,
      composeDraftMarkdown: 'Draft body',
      selectedUri: '/v/Inbox/x.md',
    });
  });

  it('treats blank selectedUri as null', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {selectedUri: '  '},
    });
    expect(out?.inbox.selectedUri).toBeNull();
  });

  it('ignores non-boolean inbox flags', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {composingNewEntry: 'yes'},
    });
    expect(out?.inbox.composingNewEntry).toBe(false);
  });

  it('parses openTabUris when present', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {
        openTabUris: ['  /v/a.md  ', '', '/v/b.md', 3 as unknown as string],
      },
    });
    expect(out?.inbox.openTabUris).toEqual(['/v/a.md', '/v/b.md']);
  });

  it('accepts per-hub-only inbox without legacy openTabUris or top-level editor tabs', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {
        composingNewEntry: false,
        selectedUri: '/v/Inbox/n.md',
        activeTodayHubUri: '/v/Today.md',
        todayHubWorkspaces: {
          '/v/Today.md': {
            editorWorkspaceTabs: [{id: 't1', entries: ['/v/Inbox/n.md'], index: 0}],
            activeEditorTabId: 't1',
            homeHistory: {entries: ['/v/Today.md'], index: 0},
          },
        },
      },
    });
    expect(out?.inbox.openTabUris).toBeUndefined();
    expect(out?.inbox.editorWorkspaceTabs).toBeUndefined();
    expect(out?.inbox.activeEditorTabId).toBeUndefined();
    expect(out?.inbox.todayHubWorkspaces?.['/v/Today.md']?.activeEditorTabId).toBe('t1');
  });

  it('accepts legacy-free inbox with only core fields when no hub snapshots exist', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {
        composingNewEntry: false,
        selectedUri: '/v/Inbox/Note.md',
        activeTodayHubUri: null,
      },
    });
    expect(out?.inbox.todayHubWorkspaces).toBeUndefined();
    expect(out?.inbox.openTabUris).toBeUndefined();
    expect(out?.inbox.editorWorkspaceTabs).toBeUndefined();
    expect(out?.inbox.activeEditorTabId).toBeUndefined();
  });

  it('still migrates legacy top-level editorWorkspaceTabs + activeEditorTabId when present', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {
        editorWorkspaceTabs: [
          {id: 't1', entries: ['  /v/a.md  '], index: 0},
          {id: '', entries: ['/v/b.md'], index: 0},
          {id: 't2', entries: [], index: 0},
          {
            id: 't3',
            entries: ['/v/c.md', '/v/d.md'],
            index: 99,
          },
        ],
        activeEditorTabId: '  t3  ',
      },
    });
    expect(out?.inbox.editorWorkspaceTabs).toEqual([
      {id: 't1', entries: ['/v/a.md'], index: 0},
      {id: 't3', entries: ['/v/c.md', '/v/d.md'], index: 1},
    ]);
    expect(out?.inbox.activeEditorTabId).toBe('t3');
  });

  it('parses notificationsPanelVisible', () => {
    const hidden = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      notificationsPanelVisible: false,
    });
    expect(hidden?.notificationsPanelVisible).toBe(false);
    const invalid = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      notificationsPanelVisible: 'yes',
    });
    expect(invalid?.notificationsPanelVisible).toBe(true);
  });

  it('parses activeTodayHubUri and todayHubWorkspaces', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/vault',
      inbox: {
        activeTodayHubUri: '  /vault/Work\\\\Today.md  ',
        todayHubWorkspaces: {
          '': {editorWorkspaceTabs: [{id: 'x', entries: ['/vault/a.md'], index: 0}]},
          '/vault/Work/Today.md': {
            editorWorkspaceTabs: [
              {id: 't1', entries: ['/vault/Work/Today.md', '/vault/x.md'], index: 0},
            ],
            activeEditorTabId: 't1',
          },
          notAnObject: 1,
          bad: null,
        },
      },
    });
    expect(out?.inbox.activeTodayHubUri).toBe('/vault/Work/Today.md');
    expect(out?.inbox.todayHubWorkspaces).toEqual({
      '/vault/Work/Today.md': {
        editorWorkspaceTabs: [
          {id: 't1', entries: ['/vault/Work/Today.md', '/vault/x.md'], index: 0},
        ],
        activeEditorTabId: 't1',
      },
    });
  });

  it('parses optional homeHistory on hub snapshots', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/vault',
      inbox: {
        todayHubWorkspaces: {
          '/vault/Daily/Today.md': {
            editorWorkspaceTabs: [{id: 't1', entries: ['/vault/Inbox/A.md'], index: 0}],
            activeEditorTabId: 't1',
            homeHistory: {
              entries: ['/vault/Daily/Today.md', '/vault/Inbox/B.md'],
              index: 1,
            },
          },
        },
      },
    });
    expect(out?.inbox.todayHubWorkspaces?.['/vault/Daily/Today.md']?.homeHistory).toEqual({
      entries: ['/vault/Daily/Today.md', '/vault/Inbox/B.md'],
      index: 1,
    });
  });

  it('treats blank activeTodayHubUri as null', () => {
    const out = normalizeMainWindowUiPayload({
      vaultRoot: '/v',
      inbox: {activeTodayHubUri: '  '},
    });
    expect(out?.inbox.activeTodayHubUri).toBeNull();
  });
});

describe('buildStoredMainWindowInboxForPersist', () => {
  const baseArgs = {
    composingNewEntry: false,
    composeDraftMarkdown: '',
    selectedUri: '/vault/Inbox/Sel.md',
    activeTodayHubUri: null as string | null,
    todayHubWorkspaces: {} as Record<string, TodayHubWorkspaceSnapshot>,
  };

  it('omits top-level tab fields when the vault index includes a Today hub', () => {
    const tab = createEditorWorkspaceTab('/vault/Inbox/Note.md', 't1');
    const inbox = buildStoredMainWindowInboxForPersist({
      ...baseArgs,
      vaultMarkdownRefs: [{name: 'Today', uri: '/vault/Daily/Today.md'}],
      editorWorkspaceTabs: [tab],
      activeEditorTabId: 't1',
    });
    expect(inbox.editorWorkspaceTabs).toBeUndefined();
    expect(inbox.activeEditorTabId).toBeUndefined();
    expect(inbox.openTabUris).toBeUndefined();
    expect(inbox.todayHubWorkspaces).toEqual({});
  });

  it('writes top-level tab snapshot when no Today hub is indexed', () => {
    const tab = createEditorWorkspaceTab('/vault/Inbox/Note.md', 't1');
    const inbox = buildStoredMainWindowInboxForPersist({
      ...baseArgs,
      vaultMarkdownRefs: [{name: 'Note', uri: '/vault/Inbox/Note.md'}],
      editorWorkspaceTabs: [tab],
      activeEditorTabId: 't1',
    });
    expect(inbox.editorWorkspaceTabs).toEqual([
      {id: 't1', entries: ['/vault/Inbox/Note.md'], index: 0},
    ]);
    expect(inbox.activeEditorTabId).toBe('t1');
    expect(inbox.openTabUris).toEqual(['/vault/Inbox/Note.md']);
  });
});
