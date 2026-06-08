import {describe, expect, it} from 'vitest';

import {mergeTodayRowColumns} from '@eskerra/core';

import {
  absolutePathToReminderFileUri,
  findTodayHubRowMatch,
  mapFullFileCaretToHubCellLineStart,
  reminderFileUriToAbsolutePath,
  todayHubRowTitleForNoteUri,
} from './reminderHubCellTarget';

describe('absolutePathToReminderFileUri', () => {
  it('prefixes a POSIX editor path with file://', () => {
    expect(absolutePathToReminderFileUri('/vault/Inbox/a.md')).toBe(
      'file:///vault/Inbox/a.md',
    );
  });

  it('percent-encodes spaces and reserved path bytes like the daemon scanner', () => {
    expect(absolutePathToReminderFileUri('/home/user/My Vault/Inbox/a#b?.md')).toBe(
      'file:///home/user/My%20Vault/Inbox/a%23b%3F.md',
    );
  });

  it('leaves an existing file:// URI unchanged', () => {
    const uri = 'file:///home/user/My%20Vault/Inbox/a%23b%3F.md';
    expect(absolutePathToReminderFileUri(uri)).toBe(uri);
  });

  it('round-trips with reminderFileUriToAbsolutePath', () => {
    const path = '/home/user/My Vault/Inbox/a#b?.md';
    expect(reminderFileUriToAbsolutePath(absolutePathToReminderFileUri(path))).toBe(path);
  });
});

describe('findTodayHubRowMatch', () => {
  const hubs = ['/vault/Hub/Today.md', '/vault/Other/Today.md'];

  it('matches a YYYY-MM-DD row beside a hub Today.md', () => {
    expect(findTodayHubRowMatch('/vault/Hub/2026-06-08.md', hubs)).toEqual({
      hubTodayNoteUri: '/vault/Hub/Today.md',
      rowUri: '/vault/Hub/2026-06-08.md',
    });
  });

  it('normalizes backslashes before comparing', () => {
    expect(findTodayHubRowMatch('\\vault\\Other\\2026-06-08.md', hubs)).toEqual({
      hubTodayNoteUri: '/vault/Other/Today.md',
      rowUri: '/vault/Other/2026-06-08.md',
    });
  });

  it('returns null for a non-date stem in a hub directory', () => {
    expect(findTodayHubRowMatch('/vault/Hub/Notes.md', hubs)).toBeNull();
  });

  it('returns null when the row is not beside any hub', () => {
    expect(findTodayHubRowMatch('/vault/Elsewhere/2026-06-08.md', hubs)).toBeNull();
  });

  it('does not match the hub Today.md itself', () => {
    expect(findTodayHubRowMatch('/vault/Hub/Today.md', hubs)).toBeNull();
  });
});

describe('todayHubRowTitleForNoteUri', () => {
  const hubs = ['/vault/Hub/Today.md', '/vault/Other/Today.md'];

  it('uses the hub folder label for a reminder on the hub Today.md itself', () => {
    expect(todayHubRowTitleForNoteUri('file:///vault/Hub/Today.md', hubs)).toBe('Hub');
  });

  it('uses the hub folder label for a hub-row reminder', () => {
    expect(todayHubRowTitleForNoteUri('file:///vault/Other/2026-06-08.md', hubs)).toBe('Other');
  });

  it('returns null for an ordinary note', () => {
    expect(todayHubRowTitleForNoteUri('file:///vault/Hub/Plan.md', hubs)).toBeNull();
  });
});

describe('mapFullFileCaretToHubCellLineStart', () => {
  it('snaps to the start of the line within the first column', () => {
    const row = mergeTodayRowColumns(['# Mon\n\ncall @2026-06-09 dentist', 'actions']);
    const caret = row.indexOf('@2026-06-09');
    const {col, sectionCaret} = mapFullFileCaretToHubCellLineStart(row, 2, caret);
    expect(col).toBe(0);
    // Line start is the "call ..." line within column 0.
    expect('# Mon\n\ncall @2026-06-09 dentist'.slice(sectionCaret)).toBe('call @2026-06-09 dentist');
  });

  it('maps a caret in the second column to that column at line start', () => {
    const col0 = '# Mon\n\nplain';
    const col1 = 'todo\n\nping @2026-06-10 bob';
    const row = mergeTodayRowColumns([col0, col1]);
    const caret = row.indexOf('@2026-06-10');
    const {col, sectionCaret} = mapFullFileCaretToHubCellLineStart(row, 2, caret);
    expect(col).toBe(1);
    expect(col1.slice(sectionCaret)).toBe('ping @2026-06-10 bob');
  });

  it('single-column row keeps caret in column 0', () => {
    const row = 'line one\nline two @2026-06-11';
    const caret = row.indexOf('@2026-06-11');
    const {col, sectionCaret} = mapFullFileCaretToHubCellLineStart(row, 1, caret);
    expect(col).toBe(0);
    expect(row.slice(sectionCaret)).toBe('line two @2026-06-11');
  });

  it('caret at column start maps to offset 0', () => {
    const row = mergeTodayRowColumns(['@2026-06-09 first', 'b']);
    const {col, sectionCaret} = mapFullFileCaretToHubCellLineStart(row, 2, 0);
    expect(col).toBe(0);
    expect(sectionCaret).toBe(0);
  });
});
