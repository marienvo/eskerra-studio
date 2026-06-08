import {act, fireEvent, render, waitFor} from '@testing-library/react';
import {createRef} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

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

function renderCanvas(inboxContentByUri: Record<string, string>) {
  const bridgeRef = {current: createIdleTodayHubWorkspaceBridge()};
  const wikiNavParentRef = {current: null as string | null};
  const cellEditorRef = createRef<NoteMarkdownEditorHandle>();
  const persistTodayHubRow = vi.fn(async () => {});
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

async function openThenCloseRow(rowText: string): Promise<void> {
  // Open the cell (mounts the editor + seeds localRowSections), then Escape to close it.
  const staticRich = staticCellWithText(rowText);
  expect(staticRich).not.toBeNull();
  const readonly = staticRich!.closest('.today-hub-canvas__cell-readonly');
  expect(readonly).not.toBeNull();
  await act(async () => {
    fireEvent.click(readonly!);
  });
  await act(async () => {
    fireEvent.keyDown(window, {key: 'Escape'});
  });
}

describe('TodayHubCanvas — disk truth for non-active week rows', () => {
  afterEach(() => {
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
});
