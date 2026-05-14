import {describe, expect, it} from 'vitest';

import {
  type ClosedEditorTabRecord,
  hasReopenableClosedEditorTab,
  isEditorClosedTabReopenable,
  popNextReopenableClosedTabRecord,
  pushClosedTabsFromCloseAll,
  pushClosedTabsFromCloseOther,
} from './editorClosedTabStack';

describe('hasReopenableClosedEditorTab', () => {
  const vault = '/vault';
  const noNotes = new Set<string>();
  const rec = (uri: string): ClosedEditorTabRecord => ({uri, index: 0});

  it('returns false when vaultRoot is null', () => {
    expect(hasReopenableClosedEditorTab([rec('/vault/a.md')], null, noNotes)).toBe(false);
  });

  it('returns false for an empty stack', () => {
    expect(hasReopenableClosedEditorTab([], vault, noNotes)).toBe(false);
  });

  it('returns true when the top entry is reopenable', () => {
    expect(
      hasReopenableClosedEditorTab([rec('/vault/a.md')], vault, noNotes),
    ).toBe(true);
  });

  it('returns true when only a non-top entry is reopenable', () => {
    const stack = [rec('/vault/deep.md'), rec('/outside/stale.txt')];
    expect(hasReopenableClosedEditorTab(stack, vault, noNotes)).toBe(true);
  });

  it('returns false when all entries are outside the vault', () => {
    const stack = [rec('/outside/a.md'), rec('/outside/b.md')];
    expect(hasReopenableClosedEditorTab(stack, vault, noNotes)).toBe(false);
  });

  it('returns true for an entry in the note set even without .md suffix', () => {
    const noteSet = new Set(['/vault/special']);
    expect(
      hasReopenableClosedEditorTab([rec('/vault/special')], vault, noteSet),
    ).toBe(true);
  });

  it('does not mutate the stack', () => {
    const stack = [rec('/vault/a.md'), rec('/vault/b.md')];
    hasReopenableClosedEditorTab(stack, vault, noNotes);
    expect(stack).toHaveLength(2);
  });
});

describe('isEditorClosedTabReopenable', () => {
  it('returns true for path under vault with .md suffix', () => {
    const set = new Set<string>();
    expect(
      isEditorClosedTabReopenable('/vault/Inbox/x.md', '/vault', set),
    ).toBe(true);
  });

  it('returns true when uri is in note set', () => {
    const set = new Set(['/vault/a.md']);
    expect(isEditorClosedTabReopenable('/vault/a.md', '/vault', set)).toBe(
      true,
    );
  });

  it('returns false outside vault', () => {
    expect(
      isEditorClosedTabReopenable('/other/x.md', '/vault', new Set()),
    ).toBe(false);
  });
});

describe('pushClosedTabsFromCloseOther', () => {
  it('pushes removed tabs right-to-left (LIFO reopen = rightmost first)', () => {
    const s: string[] = [];
    pushClosedTabsFromCloseOther(s, ['/a.md', '/b.md', '/c.md'], '/b.md');
    expect(s).toEqual(['/c.md', '/a.md']);
  });
});

describe('pushClosedTabsFromCloseAll', () => {
  it('pushes selected last so it is reopened first', () => {
    const s: string[] = [];
    pushClosedTabsFromCloseAll(s, ['/a.md', '/b.md', '/c.md'], '/b.md');
    expect(s).toEqual(['/c.md', '/a.md', '/b.md']);
  });

  it('pushes right-to-left when no selection in list', () => {
    const s: string[] = [];
    pushClosedTabsFromCloseAll(s, ['/a.md', '/b.md'], null);
    expect(s).toEqual(['/b.md', '/a.md']);
  });
});

describe('popNextReopenableClosedTabRecord', () => {
  const vault = '/vault';
  // Any URI under /vault ending in .md is reopenable; URIs outside /vault are stale.
  const noteSet = new Set<string>();

  const rec = (uri: string, index: number): ClosedEditorTabRecord => ({uri, index});

  it('returns { record: null, popped: 0 } and leaves an empty stack unchanged', () => {
    const stack: ClosedEditorTabRecord[] = [];
    expect(popNextReopenableClosedTabRecord(stack, vault, noteSet))
      .toEqual({record: null, popped: 0});
    expect(stack).toEqual([]);
  });

  it('pops the top entry and returns popped: 1 when it is reopenable', () => {
    const stack = [rec('/vault/Other.md', 1), rec('/vault/Note.md', 0)];
    const result = popNextReopenableClosedTabRecord(stack, vault, noteSet);
    expect(result).toEqual({record: rec('/vault/Note.md', 0), popped: 1});
    expect(stack).toEqual([rec('/vault/Other.md', 1)]);
  });

  it('skips stale top entries and returns the first reopenable one with correct popped count', () => {
    const stack = [
      rec('/vault/Untouched.md', 3),
      rec('/vault/Reopenable.md', 2),
      rec('/outside/stale2.md', 1),
      rec('/outside/stale1.md', 0),
    ];
    const result = popNextReopenableClosedTabRecord(stack, vault, noteSet);
    expect(result).toEqual({record: rec('/vault/Reopenable.md', 2), popped: 3});
    expect(stack).toEqual([rec('/vault/Untouched.md', 3)]);
  });

  it('pops all entries and returns { record: null, popped: N } when all are stale', () => {
    const stack = [
      rec('/outside/c.md', 2),
      rec('/outside/b.md', 1),
      rec('/outside/a.md', 0),
    ];
    const result = popNextReopenableClosedTabRecord(stack, vault, noteSet);
    expect(result).toEqual({record: null, popped: 3});
    expect(stack).toEqual([]);
  });
});
