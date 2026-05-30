import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {forwardRef, useImperativeHandle} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {AddToInboxDialog} from './AddToInboxDialog';

const editorHandleSpies = vi.hoisted(() => ({
  focus: vi.fn(),
}));

vi.mock('../editor/noteEditor/NoteMarkdownEditor', () => {
  const NoteMarkdownEditor = forwardRef<
    {
      focus: (options?: {
        anchor?: number;
        head?: number;
        selectAll?: boolean;
        scrollIntoView?: boolean;
      }) => void;
      getMarkdown: () => string;
    },
    {
      initialMarkdown: string;
      modEnterSaveWhenNoLink?: boolean;
      onMarkdownChange: (markdown: string) => void;
    }
  >(function NoteMarkdownEditorMock(props, ref) {
    useImperativeHandle(
      ref,
      () => ({
        focus: editorHandleSpies.focus,
        getMarkdown: () => props.initialMarkdown,
      }),
      [props.initialMarkdown],
    );

    return (
      <div
        className="cm-editor"
        data-mod-enter-save={props.modEnterSaveWhenNoLink ? 'true' : 'false'}
      >
        <div className="cm-scroller">
          <textarea
            className="cm-content"
            aria-label="Compose editor"
            value={props.initialMarkdown}
            onChange={event => props.onMarkdownChange(event.currentTarget.value)}
          />
        </div>
      </div>
    );
  });

  return {NoteMarkdownEditor};
});

describe('AddToInboxDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  const baseProps = {
    open: true,
    busy: false,
    vaultRoot: '/vault',
    editorRef: {current: null},
    composeDraftMarkdown: 'Title\n\nBody',
    composeDraftResetNonce: 1,
    onComposeDraftChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onEditorError: vi.fn(),
    onWikiLinkActivate: vi.fn(),
    onMarkdownRelativeLinkActivate: vi.fn(),
    onMarkdownExternalLinkOpen: vi.fn(),
    relativeMarkdownLinkHrefIsResolved: vi.fn(() => false),
    wikiLinkTargetIsResolved: vi.fn(() => false),
    wikiLinkCompletionCandidates: [],
    attachmentHost: {} as never,
    resolveVaultImagePreviewUrl: vi.fn(async () => null),
    linkSnippetBlockedDomains: [],
    onMuteLinkSnippetDomain: vi.fn(),
  };

  it('renders title, shortcut hint, and action buttons', () => {
    render(<AddToInboxDialog {...baseProps} />);

    expect(screen.getByText('Add to inbox')).not.toBeNull();
    expect(screen.getByText('(Ctrl+Enter to save)')).not.toBeNull();
    expect(screen.getByRole('button', {name: 'Save'})).not.toBeNull();
    expect(screen.getByRole('button', {name: 'Cancel'})).not.toBeNull();
  });

  it('enables Mod-Enter save fallback on the compose editor', () => {
    render(<AddToInboxDialog {...baseProps} />);

    expect(
      document.body.querySelector('[data-mod-enter-save="true"]'),
    ).not.toBeNull();
  });

  it('forwards Save and Cancel actions', () => {
    render(<AddToInboxDialog {...baseProps} />);

    fireEvent.click(screen.getByRole('button', {name: 'Save'}));
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));

    expect(baseProps.onSave).toHaveBeenCalledTimes(1);
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('forwards compose markdown updates', () => {
    render(<AddToInboxDialog {...baseProps} />);

    fireEvent.change(screen.getByRole('textbox', {name: 'Compose editor'}), {
      target: {value: 'Next draft'},
    });

    expect(baseProps.onComposeDraftChange).toHaveBeenCalledWith('Next draft');
  });

  it('guards against non-string draft values from stale runtime state', () => {
    render(
      <AddToInboxDialog
        {...baseProps}
        composeDraftMarkdown={{type: 'click'} as unknown as string}
      />,
    );

    expect(screen.getByRole<HTMLTextAreaElement>('textbox', {name: 'Compose editor'}).value)
      .toBe('');
  });

  it('selects all when opened and focuses at the end when clicking below content', async () => {
    const editorRef = {
      current: {
        focus: editorHandleSpies.focus,
        getMarkdown: vi.fn(() => '# Title'),
        loadMarkdown: vi.fn(),
        unfoldAllFolds: vi.fn(),
        collapseAllFolds: vi.fn(),
        replaceWikiLinkInnerAt: vi.fn(),
        replaceMarkdownLinkHrefAt: vi.fn(),
      },
    };
    render(
      <AddToInboxDialog
        {...baseProps}
        editorRef={editorRef}
        composeDraftMarkdown="# Title"
      />,
    );

    await waitFor(() => {
      expect(editorHandleSpies.focus).toHaveBeenCalledWith({
        selectAll: true,
        scrollIntoView: false,
      });
    });

    editorHandleSpies.focus.mockClear();
    const editorBlankSpace = screen
      .getByRole('textbox', {name: 'Compose editor'})
      .closest('.cm-scroller');
    expect(editorBlankSpace).not.toBeNull();
    fireEvent.mouseDown(editorBlankSpace!);

    expect(editorHandleSpies.focus).toHaveBeenCalledWith({
      anchor: '# Title'.length,
      scrollIntoView: true,
    });
  });

  it('does not refocus when the draft changes while already open', async () => {
    const editorRef = {
      current: {
        focus: editorHandleSpies.focus,
        getMarkdown: vi.fn(() => '# Title'),
        loadMarkdown: vi.fn(),
        unfoldAllFolds: vi.fn(),
        collapseAllFolds: vi.fn(),
        replaceWikiLinkInnerAt: vi.fn(),
        replaceMarkdownLinkHrefAt: vi.fn(),
      },
    };
    const {rerender} = render(
      <AddToInboxDialog
        {...baseProps}
        editorRef={editorRef}
        composeDraftMarkdown="# Title"
      />,
    );

    await waitFor(() => {
      expect(editorHandleSpies.focus).toHaveBeenCalledWith({
        selectAll: true,
        scrollIntoView: false,
      });
    });

    editorHandleSpies.focus.mockClear();
    rerender(
      <AddToInboxDialog
        {...baseProps}
        editorRef={editorRef}
        composeDraftMarkdown="# Title\nmiddle edit"
      />,
    );

    expect(editorHandleSpies.focus).not.toHaveBeenCalled();
  });
});
