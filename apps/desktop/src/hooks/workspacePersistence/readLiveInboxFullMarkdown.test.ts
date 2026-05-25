import {describe, expect, it} from 'vitest';

import type {LiveInboxMarkdownRefs} from './readLiveInboxFullMarkdown';
import {readLiveInboxFullMarkdownFromRefs} from './readLiveInboxFullMarkdown';

function makeRefs(
  overrides: Partial<Pick<LiveInboxMarkdownRefs, 'composingNewEntryRef'>> = {},
): LiveInboxMarkdownRefs {
  return {
    inboxEditorRef: {current: null},
    editorBodyRef: {current: '# Note'},
    openTimeDiskBodyRef: {current: ''},
    selectedUriRef: {current: '/vault/Inbox/note.md'},
    composingNewEntryRef: overrides.composingNewEntryRef ?? {current: false},
    inboxYamlFrontmatterInnerRef: {current: 'tags: [a]'},
    inboxEditorYamlLeadingBeforeFrontmatterRef: {current: ''},
  };
}

describe('readLiveInboxFullMarkdownFromRefs', () => {
  it('uses composingNewEntryRef for compose vs persisted frontmatter', () => {
    const composing = makeRefs({composingNewEntryRef: {current: true}});
    const editing = makeRefs({composingNewEntryRef: {current: false}});

    expect(
      readLiveInboxFullMarkdownFromRefs(composing, '# Note', '/vault/Inbox/note.md'),
    ).toBe('# Note');
    expect(
      readLiveInboxFullMarkdownFromRefs(editing, '# Note', '/vault/Inbox/note.md'),
    ).toBe('---\ntags: [a]\n---\n# Note');
  });
});
