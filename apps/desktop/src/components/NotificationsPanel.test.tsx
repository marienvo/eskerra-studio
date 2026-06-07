import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {
  REMINDER_SNOOZE_UNAVAILABLE_TEXT,
  type ReminderPaneRow,
} from '../lib/reminderPane';
import {NotificationsPanel} from './NotificationsPanel';

// Radix DropdownMenu drives its trigger/menu through pointer-capture + Popper,
// neither of which jsdom implements. Stub the few DOM methods it touches so the
// menu can open under test.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

// Far future due time for row layout tests (outside the T-3 snooze window).
const FAR_DUE_AT = new Date(2099, 10, 27, 23, 0).getTime();

function row(overrides: Partial<ReminderPaneRow> = {}): ReminderPaneRow {
  return {
    id: 'rem-1',
    source: 'reminder',
    noteUri: 'file:///vault/Daily.md',
    reminderId: 'rem-1',
    dueAtMs: FAR_DUE_AT,
    normalizedTokenText: '@2099-11-27_2300',
    vaultRelativePath: 'Daily.md',
    reminderState: 'scheduled',
    uiCaretHint: undefined,
    displayLine: 'Call the dentist back',
    removeState: 'idle',
    ...overrides,
  };
}

function renderPanel(r: ReminderPaneRow, onSnooze = vi.fn()) {
  render(
    <NotificationsPanel
      appSurface="capture"
      items={[r]}
      highlightId={null}
      onDismiss={vi.fn()}
      onClearAll={vi.fn()}
      onOpenReminder={vi.fn()}
      onRemoveReminder={vi.fn().mockResolvedValue(undefined)}
      onSnoozeReminder={onSnooze}
    />,
  );
  return {onSnooze};
}

/** Due time inside the T-3 snooze window relative to `Date.now()`. */
function dueWithinSnoozeWindow(offsetMs = 2 * 60_000): number {
  return Date.now() + offsetMs;
}

describe('NotificationsPanel reminder row', () => {
  it('renders the cleaned line + (HH:MM) and not the raw @ token', () => {
    renderPanel(row());
    expect(screen.getByText('Call the dentist back (23:00)')).toBeTruthy();
    expect(screen.queryByText(/@2099-11-27_2300/)).toBeNull();
    // Note name is the header.
    expect(screen.getByText('Daily')).toBeTruthy();
  });

  it('folds the time onto the note-name header and renders no second line when displayLine is empty', () => {
    renderPanel(row({displayLine: ''}));
    expect(screen.getByText('Daily (23:00)')).toBeTruthy();
    expect(screen.queryByText(/^\(23:00\)$/)).toBeNull();
  });

  it('hides the Snooze menu before the T-3 window (e.g. due in two weeks)', () => {
    renderPanel(row());
    expect(screen.queryByRole('button', {name: 'Snooze reminder'})).toBeNull();
    expect(document.querySelector('.notifications-panel__reminder-snooze')).toBeNull();
  });

  it('shows the Snooze menu inside the T-3 window and calls onSnooze with the chosen minutes', async () => {
    const user = userEvent.setup();
    const dueAtMs = dueWithinSnoozeWindow();
    const {onSnooze} = renderPanel(row({dueAtMs}));

    await user.click(screen.getByRole('button', {name: 'Snooze reminder'}));
    await user.click(await screen.findByText('At due time'));

    expect(onSnooze).toHaveBeenCalledWith('file:///vault/Daily.md', 'rem-1', 0);
  });

  it('hides the Snooze menu when the reminder is fully overdue (no live snoozes)', () => {
    renderPanel(row({dueAtMs: Date.now() - 60_000}));
    expect(screen.queryByRole('button', {name: 'Snooze reminder'})).toBeNull();
    expect(document.querySelector('.notifications-panel__reminder-snooze')).toBeNull();
  });

  it('styles overdue reminder rows with muted blue-grey like past date pills', () => {
    const {container} = render(
      <NotificationsPanel
        appSurface="capture"
        items={[row({dueAtMs: Date.now() - 60_000})]}
        highlightId={null}
        onDismiss={vi.fn()}
        onClearAll={vi.fn()}
        onOpenReminder={vi.fn()}
        onRemoveReminder={vi.fn().mockResolvedValue(undefined)}
        onSnoozeReminder={vi.fn()}
      />,
    );
    const reminderRow = container.querySelector('.notifications-panel__row--reminder-due');
    expect(reminderRow).toBeTruthy();
  });

  it('hides the Snooze menu for a stale reminder', () => {
    renderPanel(row({reminderState: 'stale'}));
    expect(screen.queryByRole('button', {name: 'Snooze reminder'})).toBeNull();
  });

  it('shows the transient snooze-unavailable hint on the row status line', () => {
    renderPanel(row({snoozeUnavailableHint: true}));
    expect(screen.getByText(REMINDER_SNOOZE_UNAVAILABLE_TEXT)).toBeTruthy();
  });

  it('refreshes snooze options when the menu opens after a boundary passes', async () => {
    const base = 1_700_000_000_000;
    const dueAtMs = base + 4 * 60_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base + 2 * 60_000);

    renderPanel(row({dueAtMs}));

    const user = userEvent.setup();
    // Past the T-1 boundary but still before due.
    nowSpy.mockReturnValue(base + 3 * 60_000 + 30_000);
    await user.click(screen.getByRole('button', {name: 'Snooze reminder'}));

    expect(screen.queryByText('3 min before')).toBeNull();
    expect(screen.queryByText('1 min before')).toBeNull();
    expect(screen.getByText('At due time')).toBeTruthy();

    nowSpy.mockRestore();
  });

  it('does not invoke onSnooze when the chosen offset expired before selection', async () => {
    const base = 1_700_000_000_000;
    const dueAtMs = base + 4 * 60_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base + 2 * 60_000);
    const {onSnooze} = renderPanel(row({dueAtMs}));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: 'Snooze reminder'}));
    expect(await screen.findByText('1 min before')).toBeTruthy();

    nowSpy.mockReturnValue(base + 3 * 60_000 + 1);
    await user.click(screen.getByText('1 min before'));

    expect(onSnooze).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
