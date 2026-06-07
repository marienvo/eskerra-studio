import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeAll, describe, expect, it, vi} from 'vitest';

import type {ReminderPaneRow} from '../lib/reminderPane';
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

// A due time of 23:00 local, far in the future so all three snoozes are live.
const DUE_AT = new Date(2099, 10, 27, 23, 0).getTime();

function row(overrides: Partial<ReminderPaneRow> = {}): ReminderPaneRow {
  return {
    id: 'rem-1',
    source: 'reminder',
    noteUri: 'file:///vault/Daily.md',
    reminderId: 'rem-1',
    dueAtMs: DUE_AT,
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

  it('shows the Snooze menu and calls onSnooze with the chosen minutes', async () => {
    const user = userEvent.setup();
    const {onSnooze} = renderPanel(row());

    await user.click(screen.getByRole('button', {name: 'Snooze reminder'}));
    // The menu offers all three live options; pick "1 min before" (snooze-1).
    await user.click(await screen.findByText('1 min before'));

    expect(onSnooze).toHaveBeenCalledWith('file:///vault/Daily.md', 'rem-1', 1);
  });

  it('hides the Snooze menu when the reminder is fully overdue (no live snoozes)', () => {
    renderPanel(row({dueAtMs: Date.now() - 60_000}));
    expect(screen.queryByRole('button', {name: 'Snooze reminder'})).toBeNull();
  });

  it('hides the Snooze menu for a stale reminder', () => {
    renderPanel(row({reminderState: 'stale'}));
    expect(screen.queryByRole('button', {name: 'Snooze reminder'})).toBeNull();
  });
});
