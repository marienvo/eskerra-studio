import {describe, expect, it} from 'vitest';

import {countInboxVaultMarkdownRefs} from './countInboxVaultMarkdownRefs';

describe('countInboxVaultMarkdownRefs', () => {
  const root = '/vault';

  it('returns 0 for an empty list', () => {
    expect(countInboxVaultMarkdownRefs(root, [])).toBe(0);
  });

  it('ignores markdown outside Inbox', () => {
    expect(
      countInboxVaultMarkdownRefs(root, [
        {uri: '/vault/General/Note.md', name: 'Note'},
        {uri: '/vault/Projects/x.md', name: 'x'},
      ]),
    ).toBe(0);
  });

  it('does not count paths that only share an Inbox prefix (e.g. InboxBackup)', () => {
    expect(
      countInboxVaultMarkdownRefs(root, [{uri: '/vault/InboxBackup/n.md', name: 'n'}]),
    ).toBe(0);
  });

  it('counts flat Inbox notes', () => {
    expect(
      countInboxVaultMarkdownRefs(root, [{uri: '/vault/Inbox/a.md', name: 'a'}]),
    ).toBe(1);
  });

  it('counts nested Inbox notes', () => {
    expect(
      countInboxVaultMarkdownRefs(root, [
        {uri: '/vault/Inbox/sub/b.md', name: 'b'},
        {uri: '/vault/Inbox/a.md', name: 'a'},
      ]),
    ).toBe(2);
  });

  it('normalizes backslashes and trailing slashes on vault root', () => {
    expect(
      countInboxVaultMarkdownRefs('C:\\vault\\', [{uri: 'C:\\vault\\Inbox\\n.md', name: 'n'}]),
    ).toBe(1);
  });
});
