import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {RefObject} from 'react';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {useOpenReminderNavigation} from './useOpenReminderNavigation';

type OpenReminderRequest = {
  noteUri: string;
  reminderId: string;
  uiCaretHint?: number;
};

type EventHandler = (event: {payload: OpenReminderRequest}) => void;

const tauriTest = vi.hoisted(() => {
  const state: {
    handlers: EventHandler[];
    invoke: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
  } = {
    handlers: [],
    invoke: vi.fn(),
    listen: vi.fn(),
  };

  const reset = (): void => {
    state.handlers = [];
    state.invoke.mockReset();
    state.listen.mockReset();
    state.invoke.mockResolvedValue(null);
    state.listen.mockImplementation((_eventName: string, handler: EventHandler) => {
      state.handlers.push(handler);
      return Promise.resolve(vi.fn());
    });
  };

  const emitOpenReminder = (payload: OpenReminderRequest): void => {
    for (const handler of state.handlers) {
      handler({payload});
    }
  };

  return {state, reset, emitOpenReminder};
});

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: tauriTest.state.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriTest.state.listen,
}));

describe('useOpenReminderNavigation', () => {
  beforeEach(() => {
    tauriTest.reset();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  async function flushMicrotasks(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function renderReminderHook({
    initialVaultHydrateAttemptDone,
    openMarkdownInEditor = vi.fn(() => Promise.resolve()),
    focus = vi.fn(),
    getMarkdown = vi.fn(() => 'editor markdown'),
  }: {
    initialVaultHydrateAttemptDone: boolean;
    openMarkdownInEditor?: (uri: string) => Promise<void>;
    focus?: NoteMarkdownEditorHandle['focus'];
    getMarkdown?: NoteMarkdownEditorHandle['getMarkdown'];
  }) {
    const inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null> = {
      current: {focus, getMarkdown},
    } as RefObject<NoteMarkdownEditorHandle | null>;

    const hook = renderHook(
      ({hydrated}: {hydrated: boolean}) =>
        useOpenReminderNavigation({
          openMarkdownInEditor,
          inboxEditorRef,
          initialVaultHydrateAttemptDone: hydrated,
        }),
      {initialProps: {hydrated: initialVaultHydrateAttemptDone}},
    );

    return {hook, openMarkdownInEditor, focus};
  }

  it('opens the decoded file path and resolves caret from editor markdown with the original reminder URI', async () => {
    const openMarkdownInEditor = vi.fn(() => Promise.resolve());
    const focus = vi.fn();
    tauriTest.state.invoke.mockImplementation((command: string) => {
      if (command === 'reminders_resolve_position_in_markdown') {
        return Promise.resolve({caretUtf16: 42});
      }
      return Promise.resolve(null);
    });

    renderReminderHook({
      initialVaultHydrateAttemptDone: true,
      openMarkdownInEditor,
      focus,
      getMarkdown: vi.fn(() => 'visible editor markdown @2026-06-06'),
    });
    await flushMicrotasks();

    const noteUri = 'file:///home/user/My%20Vault/Inbox/a%23b%3F.md';
    act(() => {
      tauriTest.emitOpenReminder({noteUri, reminderId: 'reminder-1', uiCaretHint: 7});
    });

    await waitFor(() => {
      expect(openMarkdownInEditor).toHaveBeenCalledWith('/home/user/My Vault/Inbox/a#b?.md');
    });
    await waitFor(() => {
      expect(tauriTest.state.invoke).toHaveBeenCalledWith('reminders_resolve_position_in_markdown', {
        noteUri,
        reminderId: 'reminder-1',
        markdown: 'visible editor markdown @2026-06-06',
      });
    });
    expect(tauriTest.state.invoke).not.toHaveBeenCalledWith(
      'reminders_resolve_position',
      expect.anything(),
    );
    expect(focus).toHaveBeenCalledWith({anchor: 42, scrollIntoView: true});
  });

  it('falls back to disk resolution only when editor markdown is unavailable', async () => {
    const openMarkdownInEditor = vi.fn(() => Promise.resolve());
    const focus = vi.fn();
    const getMarkdown = vi.fn(() => {
      throw new Error('editor unavailable');
    });
    tauriTest.state.invoke.mockImplementation((command: string) => {
      if (command === 'reminders_resolve_position') {
        return Promise.resolve({caretUtf16: 55});
      }
      return Promise.resolve(null);
    });

    renderReminderHook({
      initialVaultHydrateAttemptDone: true,
      openMarkdownInEditor,
      focus,
      getMarkdown,
    });
    await flushMicrotasks();

    const noteUri = 'file:///home/user/vault/Inbox/note.md';
    act(() => {
      tauriTest.emitOpenReminder({noteUri, reminderId: 'reminder-1'});
    });
    await waitFor(() => {
      expect(tauriTest.state.invoke).toHaveBeenCalledWith('reminders_resolve_position', {
        noteUri,
        reminderId: 'reminder-1',
      });
    });
    expect(tauriTest.state.invoke).not.toHaveBeenCalledWith(
      'reminders_resolve_position_in_markdown',
      expect.anything(),
    );
    expect(focus).toHaveBeenCalledWith({anchor: 55, scrollIntoView: true});
  });

  it('uses uiCaretHint when disk resolution returns null', async () => {
    const openMarkdownInEditor = vi.fn(() => Promise.resolve());
    const focus = vi.fn();
    const getMarkdown = vi.fn(() => {
      throw new Error('editor unavailable');
    });
    tauriTest.state.invoke.mockImplementation((command: string) => {
      if (command === 'reminders_resolve_position') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    renderReminderHook({
      initialVaultHydrateAttemptDone: true,
      openMarkdownInEditor,
      focus,
      getMarkdown,
    });
    await flushMicrotasks();

    act(() => {
      tauriTest.emitOpenReminder({
        noteUri: 'file:///home/user/vault/Inbox/note.md',
        reminderId: 'reminder-1',
        uiCaretHint: 17,
      });
    });

    await waitFor(() => {
      expect(focus).toHaveBeenCalledWith({anchor: 17, scrollIntoView: true});
    });
  });
  it('does not use stale disk content when editor-visible markdown has no resolvable token', async () => {
    const openMarkdownInEditor = vi.fn(() => Promise.resolve());
    const focus = vi.fn();
    tauriTest.state.invoke.mockImplementation((command: string) => {
      if (command === 'reminders_resolve_position_in_markdown') {
        return Promise.resolve(null);
      }
      if (command === 'reminders_resolve_position') {
        return Promise.resolve({caretUtf16: 999});
      }
      return Promise.resolve(null);
    });

    renderReminderHook({
      initialVaultHydrateAttemptDone: true,
      openMarkdownInEditor,
      focus,
      getMarkdown: vi.fn(() => 'unsaved editor text without the old token'),
    });
    await flushMicrotasks();

    act(() => {
      tauriTest.emitOpenReminder({
        noteUri: 'file:///home/user/vault/Inbox/note.md',
        reminderId: 'reminder-1',
        uiCaretHint: 23,
      });
    });

    await waitFor(() => {
      expect(focus).toHaveBeenCalledWith({anchor: 23, scrollIntoView: true});
    });
    expect(tauriTest.state.invoke).not.toHaveBeenCalledWith(
      'reminders_resolve_position',
      expect.anything(),
    );
  });

  it('buffers open-reminder events until initial vault hydration completes', async () => {
    const openMarkdownInEditor = vi.fn(() => Promise.resolve());
    const {hook} = renderReminderHook({
      initialVaultHydrateAttemptDone: false,
      openMarkdownInEditor,
    });
    await flushMicrotasks();

    act(() => {
      tauriTest.emitOpenReminder({
        noteUri: 'file:///home/user/vault/Inbox/note.md',
        reminderId: 'reminder-1',
      });
    });
    await flushMicrotasks();
    expect(openMarkdownInEditor).not.toHaveBeenCalled();

    hook.rerender({hydrated: true});

    await waitFor(() => {
      expect(openMarkdownInEditor).toHaveBeenCalledWith('/home/user/vault/Inbox/note.md');
    });
  });

  it('drains queued native pending requests after initial vault hydration completes', async () => {
    const openMarkdownInEditor = vi.fn(() => Promise.resolve());
    const queued: Array<OpenReminderRequest | null> = [
      {noteUri: 'file:///home/user/vault/Inbox/one.md', reminderId: 'reminder-1'},
      {noteUri: 'file:///home/user/vault/Inbox/two.md', reminderId: 'reminder-2'},
      null,
    ];
    tauriTest.state.invoke.mockImplementation((command: string) => {
      if (command === 'reminders_take_pending_open') {
        return Promise.resolve(queued.shift() ?? null);
      }
      return Promise.resolve(null);
    });
    const {hook} = renderReminderHook({
      initialVaultHydrateAttemptDone: false,
      openMarkdownInEditor,
    });
    await flushMicrotasks();

    expect(openMarkdownInEditor).not.toHaveBeenCalled();
    hook.rerender({hydrated: true});
    await waitFor(() => {
      expect(openMarkdownInEditor).toHaveBeenCalledWith('/home/user/vault/Inbox/one.md');
      expect(openMarkdownInEditor).toHaveBeenCalledWith('/home/user/vault/Inbox/two.md');
    });
  });

  it('unlistens when cleanup runs before listen resolves', async () => {
    let resolveListen: ((unlisten: () => void) => void) | null = null;
    const unlisten = vi.fn();
    tauriTest.state.listen.mockImplementation(
      () =>
        new Promise<() => void>(resolve => {
          resolveListen = resolve;
        }),
    );

    const {hook} = renderReminderHook({initialVaultHydrateAttemptDone: true});
    hook.unmount();

    await act(async () => {
      resolveListen?.(unlisten);
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the same open-reminder request while navigation is active', async () => {
    let resolveOpen: (() => void) | null = null;
    const openMarkdownInEditor = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveOpen = resolve;
        }),
    );
    renderReminderHook({
      initialVaultHydrateAttemptDone: true,
      openMarkdownInEditor,
    });
    await flushMicrotasks();

    const req = {
      noteUri: 'file:///home/user/vault/Inbox/note.md',
      reminderId: 'reminder-1',
    };
    act(() => {
      tauriTest.emitOpenReminder(req);
      tauriTest.emitOpenReminder(req);
    });

    await waitFor(() => {
      expect(openMarkdownInEditor).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveOpen?.();
      await Promise.resolve();
    });

    expect(openMarkdownInEditor).toHaveBeenCalledTimes(1);
  });

  it('drains a stored copy of an emitted already-running request without duplicate navigation', async () => {
    let resolveOpen: (() => void) | null = null;
    let nativePending: OpenReminderRequest | null = null;
    const openMarkdownInEditor = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveOpen = resolve;
        }),
    );
    tauriTest.state.invoke.mockImplementation((command: string) => {
      if (command === 'reminders_take_pending_open') {
        const req = nativePending;
        nativePending = null;
        return Promise.resolve(req);
      }
      return Promise.resolve(null);
    });
    renderReminderHook({
      initialVaultHydrateAttemptDone: true,
      openMarkdownInEditor,
    });
    await flushMicrotasks();

    const req = {
      noteUri: 'file:///home/user/vault/Inbox/note.md',
      reminderId: 'reminder-1',
    };
    nativePending = req;
    act(() => {
      tauriTest.emitOpenReminder(req);
    });

    await waitFor(() => {
      expect(openMarkdownInEditor).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveOpen?.();
      await Promise.resolve();
    });

    expect(openMarkdownInEditor).toHaveBeenCalledTimes(1);
  });
});
