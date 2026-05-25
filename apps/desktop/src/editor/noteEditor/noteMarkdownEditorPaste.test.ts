import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {describe, expect, it, vi} from 'vitest';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {
  createNoteMarkdownPasteHandlers,
  normalizeMainEditorPastedMarkdown,
  pasteBlockWhileBusy,
} from './noteMarkdownEditorPaste';

function attachmentHostStub(
  overrides: Partial<NoteInboxAttachmentHost> = {},
): NoteInboxAttachmentHost {
  return {
    isVaultImageImportAvailable: true,
    importPastedImages: vi.fn(async () => []),
    readNativeClipboardPaste: vi.fn(async () => ({
      kind: 'fail',
      message: 'test',
    })),
    importDroppedFiles: vi.fn(async () => []),
    importDroppedAbsolutePaths: vi.fn(async () => []),
    subscribeWindowFileDragDrop: vi.fn(async () => () => {}),
    ...overrides,
  };
}

function minimalView(doc = ''): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({doc}),
  });
  return view;
}

function mockDataTransfer(
  data: Record<string, string>,
  extraTypes: string[] = [],
): DataTransfer {
  const emptyFiles = {length: 0, item: () => null};
  const types = [...new Set([...Object.keys(data), ...extraTypes])];
  return {
    types,
    getData: (type: string) => data[type] ?? '',
    files: emptyFiles,
    items: {length: 0},
  } as DataTransfer;
}

describe('pasteBlockWhileBusy', () => {
  it('blocks vault image paste while busy', () => {
    const busyRef = {current: true};
    const reportError = vi.fn();
    const event = {
      preventDefault: vi.fn(),
      clipboardData: mockDataTransfer({}, ['image/png']),
    } as unknown as ClipboardEvent;
    expect(pasteBlockWhileBusy(event, busyRef, reportError)).toBe(true);
    expect(reportError).toHaveBeenCalled();
  });
});

describe('createNoteMarkdownPasteHandlers', () => {
  it('arms middle-click paste block', () => {
    const vaultRootRef = {current: '/vault'};
    const attachmentHostRef = {
      current: attachmentHostStub(),
    };
    const activeNotePathRef = {current: '/vault/Inbox/a.md'};
    const busyRef = {current: false};
    const handlers = createNoteMarkdownPasteHandlers({
      vaultRootRef,
      attachmentHostRef,
      activeNotePathRef,
      busyRef,
      reportError: vi.fn(),
      isStaleView: () => false,
      normalizePastedMarkdown: md =>
        normalizeMainEditorPastedMarkdown(md, activeNotePathRef.current),
    });
    handlers.armMiddleClickPasteBlock();
    expect(handlers.isMiddleClickPasteBlocked()).toBe(true);
  });

  it('native clipboard text bypasses remark normalizePastedMarkdown', async () => {
    const view = minimalView('');
    const vaultRootRef = {current: '/vault'};
    const normalizePastedMarkdown = vi.fn(() => 'SHOULD_NOT_RUN');
    const attachmentHostRef = {
      current: attachmentHostStub({
        readNativeClipboardPaste: vi.fn(async () => ({
          kind: 'text' as const,
          text: 'plain url https://example.com',
        })),
      }),
    };
    const handlers = createNoteMarkdownPasteHandlers({
      vaultRootRef,
      attachmentHostRef,
      activeNotePathRef: {current: '/vault/Inbox/a.md'},
      busyRef: {current: false},
      reportError: vi.fn(),
      isStaleView: () => false,
      normalizePastedMarkdown,
    });
    const dt = mockDataTransfer({'text/plain': ''});
    const event = {preventDefault: vi.fn(), stopPropagation: vi.fn()};
    handlers.onEditorPaste(event as unknown as ClipboardEvent, view);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe('plain url https://example.com');
    });
    expect(normalizePastedMarkdown).not.toHaveBeenCalled();
    view.destroy();
  });

  it('runPasteFromDataTransfer returns null for plain text without html (cell plain pipe paste)', () => {
    const view = minimalView('hi');
    const vaultRootRef = {current: '/vault'};
    const attachmentHostRef = {
      current: attachmentHostStub(),
    };
    const handlers = createNoteMarkdownPasteHandlers({
      vaultRootRef,
      attachmentHostRef,
      activeNotePathRef: {current: null},
      busyRef: {current: false},
      reportError: vi.fn(),
      isStaleView: () => false,
      normalizePastedMarkdown: s => s,
      consumeEmptyHtmlPaste: false,
    });
    const dt = mockDataTransfer({'text/plain': 'hello'});
    const event = {preventDefault: vi.fn(), stopPropagation: vi.fn()};
    expect(
      handlers.runPasteFromDataTransfer(
        dt,
        event as unknown as ClipboardEvent,
        view,
      ),
    ).toBeNull();
    view.destroy();
  });
});
