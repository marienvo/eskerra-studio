import {describe, expect, it} from 'vitest';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {
  deriveTodayHubShowCanvas,
  deriveTodayHubSelectorItems,
  deriveTodayHubSettings,
  deriveTodayHubWorkspacesPersistFiltered,
  injectActiveHubIntoTodayHubPersistMap,
} from './workspaceTodayHubDerived';

// ---------------------------------------------------------------------------
// deriveTodayHubShowCanvas
// ---------------------------------------------------------------------------

describe('deriveTodayHubShowCanvas', () => {
  const vault = '/home/user/vault';
  const today = '/home/user/vault/Daily/Today.md';
  const other = '/home/user/vault/Inbox/Note.md';

  it('returns true for Today.md under the active vault root', () => {
    expect(deriveTodayHubShowCanvas(vault, today, false)).toBe(true);
  });

  it('returns false while composing a new entry', () => {
    expect(deriveTodayHubShowCanvas(vault, today, true)).toBe(false);
  });

  it('returns false for a non-Today.md note', () => {
    expect(deriveTodayHubShowCanvas(vault, other, false)).toBe(false);
  });

  it('returns false when selectedUri is null', () => {
    expect(deriveTodayHubShowCanvas(vault, null, false)).toBe(false);
  });

  it('returns false when vaultRoot is null', () => {
    expect(deriveTodayHubShowCanvas(null, today, false)).toBe(false);
  });

  it('returns false for Today.md outside the active vault root', () => {
    expect(
      deriveTodayHubShowCanvas('/home/user/vault', '/home/user/other-vault/Daily/Today.md', false),
    ).toBe(false);
  });

  it('returns true with a trailing slash on the vault root', () => {
    expect(deriveTodayHubShowCanvas('/home/user/vault/', today, false)).toBe(true);
  });

  it('returns true for Today.md placed directly inside the vault root (no sub-folder)', () => {
    expect(deriveTodayHubShowCanvas(vault, `${vault}/Today.md`, false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveTodayHubSelectorItems
// ---------------------------------------------------------------------------

describe('deriveTodayHubSelectorItems', () => {
  it('returns an empty array when there are no Today.md refs', () => {
    const refs = [{name: 'Note', uri: '/vault/Inbox/Note.md'}];
    expect(deriveTodayHubSelectorItems(refs, [])).toEqual([]);
  });

  it('returns items in sortedTodayHubNoteUrisFromRefs order', () => {
    const refs = [
      {name: 'Today', uri: '/vault/Beta/Today.md'},
      {name: 'Today', uri: '/vault/Alpha/Today.md'},
    ];
    const items = deriveTodayHubSelectorItems(refs, []);
    expect(items.map(i => i.todayNoteUri)).toEqual([
      '/vault/Alpha/Today.md',
      '/vault/Beta/Today.md',
    ]);
  });

  it('uses the parent folder name as label for Today.md hubs', () => {
    const refs = [{name: 'Today', uri: '/vault/Daily/Today.md'}];
    const items = deriveTodayHubSelectorItems(refs, []);
    expect(items[0]?.label).toBe('Daily');
  });

  it('uses the parent folder name even when the URI also exists in the notes list', () => {
    const refs = [{name: 'Today', uri: '/vault/Weekly/Today.md'}];
    const notes = [{name: 'Weekly.md', uri: '/vault/Weekly/Today.md'}];
    const items = deriveTodayHubSelectorItems(refs, notes);
    // vaultUriIsTodayMarkdownFile → todayHubFolderLabelFromUri wins over notes lookup
    expect(items[0]?.label).toBe('Weekly');
  });
});

// ---------------------------------------------------------------------------
// deriveTodayHubWorkspacesPersistFiltered
// ---------------------------------------------------------------------------

describe('deriveTodayHubWorkspacesPersistFiltered', () => {
  const snap = {editorWorkspaceTabs: []};

  it('keeps only hub URIs that are present in vaultMarkdownRefs', () => {
    const refs = [{name: 'Today', uri: '/vault/Daily/Today.md'}];
    const workspaces = {
      '/vault/Daily/Today.md': snap,
      '/vault/Old/Today.md': snap,
    };
    expect(deriveTodayHubWorkspacesPersistFiltered(refs, workspaces)).toEqual({
      '/vault/Daily/Today.md': snap,
    });
  });

  it('returns an empty object when refs has no Today.md files', () => {
    const refs = [{name: 'Note', uri: '/vault/Inbox/Note.md'}];
    const workspaces = {'/vault/Daily/Today.md': snap};
    expect(deriveTodayHubWorkspacesPersistFiltered(refs, workspaces)).toEqual({});
  });

  it('returns an empty object when workspacesForSave is empty', () => {
    const refs = [{name: 'Today', uri: '/vault/Daily/Today.md'}];
    expect(deriveTodayHubWorkspacesPersistFiltered(refs, {})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// injectActiveHubIntoTodayHubPersistMap
// ---------------------------------------------------------------------------

describe('injectActiveHubIntoTodayHubPersistMap', () => {
  const hubUri = '/vault/Daily/Today.md';

  const makeTab = (id: string, uri: string): EditorWorkspaceTab => ({
    id,
    history: {entries: [uri], index: 0},
  });

  it('returns merged unchanged (same reference) when activeTodayHubUri is null', () => {
    const merged: Record<string, TodayHubWorkspaceSnapshot> = {
      [hubUri]: {editorWorkspaceTabs: []},
    };
    const result = injectActiveHubIntoTodayHubPersistMap({
      merged,
      activeTodayHubUri: null,
      homeStatesByHub: {},
      editorWorkspaceTabs: [],
      activeEditorTabId: null,
    });
    expect(result).toBe(merged);
  });

  it('creates a new entry with homeHistory when the active hub is absent from merged', () => {
    const tab = makeTab('etab-1', '/vault/Inbox/Note.md');
    const result = injectActiveHubIntoTodayHubPersistMap({
      merged: {},
      activeTodayHubUri: hubUri,
      homeStatesByHub: {
        [hubUri]: {
          history: {
            entries: [hubUri, '/vault/Inbox/Home.md'],
            index: 1,
          },
        },
      },
      editorWorkspaceTabs: [tab],
      activeEditorTabId: 'etab-1',
    });
    expect(result[hubUri]?.activeEditorTabId).toBe('etab-1');
    expect(result[hubUri]?.editorWorkspaceTabs).toEqual([
      {id: 'etab-1', entries: ['/vault/Inbox/Note.md'], index: 0},
    ]);
    expect(result[hubUri]?.homeHistory).toEqual({
      entries: [hubUri, '/vault/Inbox/Home.md'],
      index: 1,
    });
  });

  it('preserves prior homeHistory and overrides tabs on an existing entry', () => {
    const priorHomeHistory = {entries: [hubUri], index: 0};
    const existing: TodayHubWorkspaceSnapshot = {
      editorWorkspaceTabs: [],
      homeHistory: priorHomeHistory,
    };
    const tab = makeTab('etab-2', '/vault/Inbox/X.md');
    const result = injectActiveHubIntoTodayHubPersistMap({
      merged: {[hubUri]: existing},
      activeTodayHubUri: hubUri,
      homeStatesByHub: {},
      editorWorkspaceTabs: [tab],
      activeEditorTabId: 'etab-2',
    });
    expect(result[hubUri]?.homeHistory).toBe(priorHomeHistory);
    expect(result[hubUri]?.activeEditorTabId).toBe('etab-2');
    expect(result[hubUri]?.editorWorkspaceTabs).toEqual([
      {id: 'etab-2', entries: ['/vault/Inbox/X.md'], index: 0},
    ]);
  });

  it('applies tabsToStored conversion (multi-entry history is flattened to stored format)', () => {
    const tab: EditorWorkspaceTab = {
      id: 'etab-3',
      history: {entries: ['/vault/Inbox/A.md', '/vault/Inbox/B.md'], index: 1},
    };
    const result = injectActiveHubIntoTodayHubPersistMap({
      merged: {},
      activeTodayHubUri: hubUri,
      homeStatesByHub: {},
      editorWorkspaceTabs: [tab],
      activeEditorTabId: 'etab-3',
    });
    expect(result[hubUri]?.editorWorkspaceTabs).toEqual([
      {id: 'etab-3', entries: ['/vault/Inbox/A.md', '/vault/Inbox/B.md'], index: 1},
    ]);
  });
});

// ---------------------------------------------------------------------------
// deriveTodayHubSettings
// ---------------------------------------------------------------------------

describe('deriveTodayHubSettings', () => {
  const base = {
    showTodayHubCanvas: true,
    selectedUri: '/vault/Daily/Today.md',
    editorBody: '',
    composingNewEntry: false,
    inboxYamlFrontmatterInner: null,
    inboxEditorYamlLeadingBeforeFrontmatter: '',
  };

  it('returns null when showTodayHubCanvas is false', () => {
    expect(deriveTodayHubSettings({...base, showTodayHubCanvas: false})).toBeNull();
  });

  it('returns null when selectedUri is null', () => {
    expect(deriveTodayHubSettings({...base, selectedUri: null})).toBeNull();
  });

  it('returns default settings for a canvas-visible Today.md with no frontmatter', () => {
    const result = deriveTodayHubSettings(base);
    expect(result).toEqual({perpetualType: 'weekly', columns: [], start: 'monday'});
  });
});
