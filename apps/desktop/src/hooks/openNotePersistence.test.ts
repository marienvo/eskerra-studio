import {describe, expect, it} from 'vitest';

import {
  persistableInboxEditorBodySlice,
  persistableInboxEditorFullMarkdown,
} from './openNotePersistence';

describe('openNotePersistence', () => {
  it('strips buffer-only open-note padding back to the persisted body', () => {
    expect(
      persistableInboxEditorBodySlice('# Title\n\n', '# Title'),
    ).toBe('# Title');
  });

  it('keeps real line-3 content instead of collapsing to the persisted body', () => {
    expect(
      persistableInboxEditorBodySlice('# Title\n\nBody', '# Title'),
    ).toBe('# Title\n\nBody');
  });

  it('rebuilds full markdown with frontmatter after collapsing editor-only padding', () => {
    expect(
      persistableInboxEditorFullMarkdown({
        editorBodySlice: '# Title\n\n',
        selectedUri: '/vault/Inbox/title.md',
        composingNewEntry: false,
        yamlInner: 'tags: [a]',
        yamlLeading: '',
        persistedFullMarkdown: '---\ntags: [a]\n---\n# Title',
      }),
    ).toBe('---\ntags: [a]\n---\n# Title');
  });
});
