import {describe, expect, it, vi} from 'vitest';

import {applyComposeSubmitResultToEditor} from './vaultTabComposeSubmitResult';

describe('applyComposeSubmitResultToEditor', () => {
  it('reloads rewritten compose markdown after a failed submit', () => {
    const editor = {loadMarkdown: vi.fn()} as never;

    applyComposeSubmitResultToEditor(editor, {
      created: false,
      rewrittenMarkdown: '# Title\n![](Assets/image.png)',
    });

    expect(editor.loadMarkdown).toHaveBeenCalledWith(
      '# Title\n![](Assets/image.png)',
      {selection: 'preserve'},
    );
  });

  it('does not reload after a successful create', () => {
    const editor = {loadMarkdown: vi.fn()} as never;

    applyComposeSubmitResultToEditor(editor, {
      created: true,
      rewrittenMarkdown: '# Title\n![](Assets/image.png)',
    });

    expect(editor.loadMarkdown).not.toHaveBeenCalled();
  });
});
