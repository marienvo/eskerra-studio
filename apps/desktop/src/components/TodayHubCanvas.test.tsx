import {act, fireEvent, render, waitFor} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {createRef} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {INBOX_AUTOSAVE_DEBOUNCE_MS} from '../lib/inboxAutosaveScheduler';

import {
  createIdleTodayHubWorkspaceBridge,
  enumerateTodayHubWeekStarts,
  todayHubRowUri,
  type TodayHubSettings,
} from '../lib/todayHub';
import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {TodayHubCanvas} from './TodayHubCanvas';

const SETTINGS: TodayHubSettings = {
  perpetualType: 'weekly',
  columns: [],
  start: 'monday',
};
const TODAY_NOTE = '/vault/A/Today.md';
const HUB_DIR = '/vault/A';

/** Index 1 = current week (index 0 is the previous week the canvas renders first). */
function currentWeekRowUri(): string {
  const starts = enumerateTodayHubWeekStarts(new Date(), SETTINGS.start);
  return todayHubRowUri(HUB_DIR, starts[1]!);
}

function renderCanvas(
  inboxContentByUri: Record<string, string>,
  options?: {persistTodayHubRow?: ReturnType<typeof vi.fn>},
) {
  const bridgeRef = {current: createIdleTodayHubWorkspaceBridge()};
  const wikiNavParentRef = {current: null as string | null};
  const cellEditorRef = createRef<NoteMarkdownEditorHandle>();
  const persistTodayHubRow =
    options?.persistTodayHubRow ?? vi.fn(async () => true);
  const prehydrateTodayHubRows = vi.fn(async () => {});

  const baseProps = {
    vaultRoot: '/vault',
    todayNoteUri: TODAY_NOTE,
    hubSettings: SETTINGS,
    vaultMarkdownRefs: [],
    bridgeRef,
    wikiNavParentRef,
    cellEditorRef,
    onWikiLinkActivate: vi.fn(),
    onMarkdownRelativeLinkActivate: vi.fn(),
    onMarkdownExternalLinkOpen: vi.fn(),
    onEditorError: vi.fn(),
    onSaveShortcut: vi.fn(),
    prehydrateTodayHubRows,
    persistTodayHubRow,
  };

  const utils = render(
    <TodayHubCanvas {...baseProps} inboxContentByUri={inboxContentByUri} />,
  );
  const rerenderWith = (next: Record<string, string>) =>
    utils.rerender(<TodayHubCanvas {...baseProps} inboxContentByUri={next} />);

  return {...utils, rerenderWith, persistTodayHubRow, bridgeRef};
}

function staticCellWithText(needle: string): HTMLElement | null {
  const cells = document.querySelectorAll<HTMLElement>(
    '.today-hub-canvas__cell-static-rich',
  );
  for (const cell of cells) {
    if ((cell.textContent ?? '').includes(needle)) {
      return cell;
    }
  }
  return null;
}

async function openRow(rowText: string): Promise<void> {
  // Open the cell (mounts/surfaces the editor + seeds localRowSections).
  const staticRich = staticCellWithText(rowText);
  expect(staticRich).not.toBeNull();
  const readonly = staticRich!.closest('.today-hub-canvas__cell-readonly');
  expect(readonly).not.toBeNull();
  await act(async () => {
    fireEvent.click(readonly!);
  });
}

async function closeActiveCell(): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, {key: 'Escape'});
  });
}

async function openThenCloseRow(rowText: string): Promise<void> {
  await openRow(rowText);
  await closeActiveCell();
}

/** Doc text of the currently-editing hub cell's CodeMirror view. */
function activeCellEditorDoc(): string | null {
  const content = document.querySelector<HTMLElement>(
    '.today-hub-canvas__cm-host--editing .cm-content',
  );
  if (!content) {
    return null;
  }
  return EditorView.findFromDOM(content)?.state.doc.toString() ?? null;
}

function setActiveCellEditorText(text: string): void {
  const content = document.querySelector<HTMLElement>(
    '.today-hub-canvas__cm-host--editing .cm-content',
  );
  expect(content).not.toBeNull();
  const view = EditorView.findFromDOM(content!);
  expect(view).not.toBeNull();
  view!.dispatch({
    changes: {from: 0, to: view!.state.doc.length, insert: text},
  });
}

describe('TodayHubCanvas — disk truth for non-active week rows', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reflects an external disk change on a previously-opened, now-inactive row', async () => {
    const rowUri = currentWeekRowUri();
    const {rerenderWith} = renderCanvas({[rowUri]: 'old content'});

    await waitFor(() => {
      expect(staticCellWithText('old content')).not.toBeNull();
    });

    await openThenCloseRow('old content');

    // External edit reconciled into the cache for this (now inactive) row.
    await act(async () => {
      rerenderWith({[rowUri]: 'new content'});
    });

    await waitFor(() => {
      expect(staticCellWithText('new content')).not.toBeNull();
    });
    expect(staticCellWithText('old content')).toBeNull();
  });

  it('clean reads disk content, not stale local sections, after an external change', async () => {
    const rowUri = currentWeekRowUri();
    const {rerenderWith, persistTodayHubRow, bridgeRef} = renderCanvas({
      [rowUri]: 'old content',
    });

    await waitFor(() => {
      expect(staticCellWithText('old content')).not.toBeNull();
    });

    await openThenCloseRow('old content');

    // External change carrying content that cleanup will normalize (trailing blank lines).
    await act(async () => {
      rerenderWith({[rowUri]: 'new content\n\n\n'});
    });
    await waitFor(() => {
      expect(staticCellWithText('new content')).not.toBeNull();
    });

    await act(async () => {
      await bridgeRef.current.cleanHubPageDayColumns();
    });

    expect(persistTodayHubRow).toHaveBeenCalled();
    for (const call of persistTodayHubRow.mock.calls) {
      const merged = String(call[1] ?? '');
      expect(merged).toContain('new content');
      expect(merged).not.toContain('old content');
    }
  });

  it('reopening a warm cell shows disk content in the editor, not its stale doc', async () => {
    const rowUri = currentWeekRowUri();
    const {rerenderWith} = renderCanvas({[rowUri]: 'first body'});

    await waitFor(() => {
      expect(staticCellWithText('first body')).not.toBeNull();
    });

    // Open (mounts the editor with the initial body) then close — the editor stays warm.
    await openRow('first body');
    await waitFor(() => {
      expect(activeCellEditorDoc()).toBe('first body');
    });
    await closeActiveCell();

    // External change (e.g. Ctrl+E cleanup / disk edit) reconciled into the cache while warm.
    await act(async () => {
      rerenderWith({[rowUri]: 'second body'});
    });
    await waitFor(() => {
      expect(staticCellWithText('second body')).not.toBeNull();
    });

    // Reopen the still-warm cell: its CodeMirror doc must reflect disk truth, not the stale doc.
    await openRow('second body');
    await waitFor(() => {
      expect(activeCellEditorDoc()).toBe('second body');
    });
  });

  it('reloads the active cell editor from disk through the workspace bridge', async () => {
    const rowUri = currentWeekRowUri();
    const {bridgeRef} = renderCanvas({[rowUri]: 'first body'});

    await waitFor(() => {
      expect(staticCellWithText('first body')).not.toBeNull();
    });
    await openRow('first body');
    await waitFor(() => {
      expect(activeCellEditorDoc()).toBe('first body');
    });

    await act(async () => {
      bridgeRef.current.reloadLiveRowFromDisk('disk body');
    });

    await waitFor(() => {
      expect(activeCellEditorDoc()).toBe('disk body');
    });
  });

  it('keeps active local edits when an external cache update arrives without a live reload', async () => {
    const rowUri = currentWeekRowUri();
    const {rerenderWith} = renderCanvas({[rowUri]: 'disk content'});

    await waitFor(() => {
      expect(staticCellWithText('disk content')).not.toBeNull();
    });
    await openRow('disk content');
    await waitFor(() => {
      expect(activeCellEditorDoc()).toBe('disk content');
    });

    await act(async () => {
      setActiveCellEditorText('local edits');
    });
    await waitFor(() => {
      expect(activeCellEditorDoc()).toBe('local edits');
    });

    await act(async () => {
      rerenderWith({[rowUri]: 'external disk content'});
    });

    expect(activeCellEditorDoc()).toBe('local edits');
  });

  it('keeps unsaved row preview after a failed persist when the cell is closed', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    try {
      const rowUri = currentWeekRowUri();
      const persistTodayHubRow = vi.fn(async () => false);
      renderCanvas({[rowUri]: 'disk content'}, {persistTodayHubRow});

      await waitFor(() => {
        expect(staticCellWithText('disk content')).not.toBeNull();
      });

      await openRow('disk content');
      await waitFor(() => {
        expect(activeCellEditorDoc()).toBe('disk content');
      });

      await act(async () => {
        setActiveCellEditorText('edited content');
      });

      await act(async () => {
        vi.advanceTimersByTime(INBOX_AUTOSAVE_DEBOUNCE_MS + 50);
      });
      await waitFor(() => {
        expect(persistTodayHubRow).toHaveBeenCalled();
      });

      await closeActiveCell();

      await waitFor(() => {
        expect(staticCellWithText('edited content')).not.toBeNull();
      });
      expect(staticCellWithText('disk content')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
