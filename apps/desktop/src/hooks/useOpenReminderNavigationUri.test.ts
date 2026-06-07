import {describe, expect, it} from 'vitest';

import {reminderFileUriToAbsolutePath} from './useOpenReminderNavigation';

describe('reminderFileUriToAbsolutePath', () => {
  it('decodes local file URIs to absolute paths', () => {
    expect(
      reminderFileUriToAbsolutePath('file:///home/user/My%20Vault/Inbox/a%23b%3F.md'),
    ).toBe('/home/user/My Vault/Inbox/a#b?.md');
  });

  it('accepts localhost file URIs', () => {
    expect(reminderFileUriToAbsolutePath('file://localhost/home/user/note.md')).toBe(
      '/home/user/note.md',
    );
  });

  it('rejects unsupported or unsafe URI forms', () => {
    expect(reminderFileUriToAbsolutePath('https://example.com/note.md')).toBeNull();
    expect(reminderFileUriToAbsolutePath('file://server/share/note.md')).toBeNull();
    expect(reminderFileUriToAbsolutePath('file:///home/user/note.md#fragment')).toBeNull();
    expect(reminderFileUriToAbsolutePath('file:///home/user/bad%ZZ.md')).toBeNull();
  });
});
