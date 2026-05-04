import {describe, expect, it} from 'vitest';

import {
  remapEditorShellScrollMapExact,
  remapEditorShellScrollMapTreePrefix,
  snapshotEditorShellScrollForOpenNote,
} from './workspaceEditorScrollMap';

describe('snapshotEditorShellScrollForOpenNote', () => {
  function makeScrollEl(top: number, left: number): HTMLDivElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollTop', {value: top, writable: true});
    Object.defineProperty(el, 'scrollLeft', {value: left, writable: true});
    return el;
  }

  it('is a no-op when scrollEl is null', () => {
    const map = new Map<string, {top: number; left: number}>();
    snapshotEditorShellScrollForOpenNote(null, 'content://vault/note.md', false, map);
    expect(map.size).toBe(0);
  });

  it('is a no-op when selectedUri is null', () => {
    const map = new Map<string, {top: number; left: number}>();
    const el = makeScrollEl(10, 20);
    snapshotEditorShellScrollForOpenNote(el, null, false, map);
    expect(map.size).toBe(0);
  });

  it('is a no-op when composingNewEntry is true', () => {
    const map = new Map<string, {top: number; left: number}>();
    const el = makeScrollEl(10, 20);
    snapshotEditorShellScrollForOpenNote(el, 'content://vault/note.md', true, map);
    expect(map.size).toBe(0);
  });

  it('stores normalized scroll position under normalized URI', () => {
    const map = new Map<string, {top: number; left: number}>();
    const el = makeScrollEl(42, 7);
    snapshotEditorShellScrollForOpenNote(el, 'content://vault/note.md', false, map);
    expect(map.get('content://vault/note.md')).toEqual({top: 42, left: 7});
  });

  it('normalizes backslashes in URI key', () => {
    const map = new Map<string, {top: number; left: number}>();
    const el = makeScrollEl(5, 3);
    snapshotEditorShellScrollForOpenNote(el, 'content://vault\\note.md', false, map);
    expect(map.get('content://vault/note.md')).toEqual({top: 5, left: 3});
  });

  it('overwrites an existing entry for the same URI', () => {
    const map = new Map<string, {top: number; left: number}>();
    map.set('content://vault/note.md', {top: 1, left: 1});
    const el = makeScrollEl(99, 0);
    snapshotEditorShellScrollForOpenNote(el, 'content://vault/note.md', false, map);
    expect(map.get('content://vault/note.md')).toEqual({top: 99, left: 0});
  });
});

describe('remapEditorShellScrollMapExact', () => {
  it('is a no-op when fromUri and toUri normalize to the same value', () => {
    const map = new Map([['content://vault/note.md', {top: 10, left: 0}]]);
    remapEditorShellScrollMapExact(map, 'content://vault/note.md', 'content://vault/note.md');
    expect(map.get('content://vault/note.md')).toEqual({top: 10, left: 0});
    expect(map.size).toBe(1);
  });

  it('is a no-op when fromUri is not in the map', () => {
    const map = new Map([['content://vault/a.md', {top: 1, left: 0}]]);
    remapEditorShellScrollMapExact(map, 'content://vault/missing.md', 'content://vault/b.md');
    expect([...map.keys()]).toEqual(['content://vault/a.md']);
  });

  it('moves the entry from fromUri to toUri', () => {
    const map = new Map([['content://vault/old.md', {top: 20, left: 5}]]);
    remapEditorShellScrollMapExact(map, 'content://vault/old.md', 'content://vault/new.md');
    expect(map.has('content://vault/old.md')).toBe(false);
    expect(map.get('content://vault/new.md')).toEqual({top: 20, left: 5});
  });

  it('normalizes backslashes in both URIs', () => {
    const map = new Map([['content://vault/old.md', {top: 3, left: 0}]]);
    remapEditorShellScrollMapExact(map, 'content://vault\\old.md', 'content://vault\\new.md');
    expect(map.has('content://vault/old.md')).toBe(false);
    expect(map.get('content://vault/new.md')).toEqual({top: 3, left: 0});
  });
});

describe('remapEditorShellScrollMapTreePrefix', () => {
  it('is a no-op when old and new prefix normalize to the same value', () => {
    const map = new Map([['content://vault/dir/note.md', {top: 1, left: 0}]]);
    remapEditorShellScrollMapTreePrefix(
      map,
      'content://vault/dir',
      'content://vault/dir',
    );
    expect(map.get('content://vault/dir/note.md')).toEqual({top: 1, left: 0});
  });

  it('remaps entries whose key starts with oldPrefix/', () => {
    const map = new Map([
      ['content://vault/old/note.md', {top: 10, left: 0}],
      ['content://vault/old/sub/other.md', {top: 5, left: 2}],
    ]);
    remapEditorShellScrollMapTreePrefix(
      map,
      'content://vault/old',
      'content://vault/new',
    );
    expect(map.has('content://vault/old/note.md')).toBe(false);
    expect(map.get('content://vault/new/note.md')).toEqual({top: 10, left: 0});
    expect(map.get('content://vault/new/sub/other.md')).toEqual({top: 5, left: 2});
  });

  it('leaves entries outside the prefix unchanged', () => {
    const map = new Map([
      ['content://vault/other/note.md', {top: 7, left: 0}],
      ['content://vault/old/note.md', {top: 3, left: 0}],
    ]);
    remapEditorShellScrollMapTreePrefix(
      map,
      'content://vault/old',
      'content://vault/new',
    );
    expect(map.get('content://vault/other/note.md')).toEqual({top: 7, left: 0});
    expect(map.has('content://vault/old/note.md')).toBe(false);
    expect(map.get('content://vault/new/note.md')).toEqual({top: 3, left: 0});
  });

  it('strips trailing slashes from both prefixes before comparing', () => {
    const map = new Map([['content://vault/dir/note.md', {top: 1, left: 0}]]);
    remapEditorShellScrollMapTreePrefix(
      map,
      'content://vault/dir/',
      'content://vault/dir/',
    );
    // same after stripping → no-op
    expect(map.get('content://vault/dir/note.md')).toEqual({top: 1, left: 0});
  });

  it('remaps directory-exact matches (entry key equals prefix)', () => {
    const map = new Map([['content://vault/old', {top: 4, left: 0}]]);
    remapEditorShellScrollMapTreePrefix(
      map,
      'content://vault/old',
      'content://vault/new',
    );
    expect(map.has('content://vault/old')).toBe(false);
    expect(map.get('content://vault/new')).toEqual({top: 4, left: 0});
  });
});
