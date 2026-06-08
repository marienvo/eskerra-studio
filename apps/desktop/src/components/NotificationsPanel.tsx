import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {useCallback, useEffect, useState} from 'react';

import type {SessionNotification} from '../lib/sessionNotifications';
import type {PaneNotification, ReminderPaneRow, SnoozeMinutes} from '../lib/reminderPane';
import {
  reminderNoteName,
  reminderDueLabel,
  reminderTimeLabel,
  snoozeMenuOptions,
  REMINDER_SNOOZE_UNAVAILABLE_TEXT,
} from '../lib/reminderPane';

import {MaterialIcon} from './MaterialIcon';

type NotificationsPanelProps = {
  /** Match vault tree (capture) vs podcasts (consume) pane chrome. */
  appSurface: 'capture' | 'consume';
  items: readonly PaneNotification[];
  highlightId: string | null;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onOpenReminder: (noteUri: string, reminderId: string, uiCaretHint?: number) => void;
  onRemoveReminder: (noteUri: string, reminderId: string) => Promise<void>;
  onSnoozeReminder: (noteUri: string, reminderId: string, minutes: number) => Promise<void>;
};

const MINUTE_TICK_MS = 60_000;

/** Menu label for each snooze offset. */
function snoozeOptionLabel(minutes: SnoozeMinutes): string {
  return minutes === 0 ? 'At due time' : `${minutes} min before`;
}

/** Wall-clock `nowMs` with an aligned minute tick and an on-demand refresh. */
function useMinuteNowMs(): {nowMs: number; refreshNowMs: () => void} {
  const [nowMs, setNowMs] = useState(Date.now);
  const refreshNowMs = useCallback(() => setNowMs(Date.now()), []);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const msUntilNextMinute = MINUTE_TICK_MS - (Date.now() % MINUTE_TICK_MS);
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, MINUTE_TICK_MS);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, []);
  return {nowMs, refreshNowMs};
}

export function NotificationsPanel({
  appSurface,
  items,
  highlightId,
  onDismiss,
  onClearAll,
  onOpenReminder,
  onRemoveReminder,
  onSnoozeReminder,
}: NotificationsPanelProps) {
  const {nowMs, refreshNowMs} = useMinuteNowMs();

  useEffect(() => {
    if (!highlightId) {
      return;
    }
    const row = document.getElementById(`desktop-notif-${highlightId}`);
    row?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }, [highlightId]);

  const hasSessionItems = items.some(i => i.source !== 'reminder');

  return (
    <div
      className="panel-surface notifications-panel"
      data-app-surface={appSurface}
    >
      <div className="pane-header pane-header--workspace-panel">
        <span className="pane-title">Notifications</span>
        <div className="pane-header-trailing-actions">
          <button
            type="button"
            className="pane-header-add-btn icon-btn-ghost app-tooltip-trigger"
            disabled={!hasSessionItems}
            aria-label="Clear all notifications"
            data-tooltip="Clear all"
            data-tooltip-placement="inline-start"
            onClick={onClearAll}
          >
            <span className="pane-header-add-btn__glyph" aria-hidden>
              <MaterialIcon name="delete_sweep" size={12} />
            </span>
          </button>
        </div>
      </div>
      <div className="notifications-panel__body">
        {items.length === 0 ? (
          <p className="notifications-panel__empty muted">No notifications yet.</p>
        ) : (
          <ul className="notifications-panel__list">
            {items.map(item =>
              item.source === 'reminder' ? (
                <ReminderRow
                  key={item.id}
                  row={item}
                  nowMs={nowMs}
                  onRefreshNowMs={refreshNowMs}
                  onOpen={onOpenReminder}
                  onRemove={onRemoveReminder}
                  onSnooze={onSnoozeReminder}
                />
              ) : (
                <SessionRow
                  key={item.id}
                  item={item}
                  highlightId={highlightId}
                  onDismiss={onDismiss}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Session notification row ──────────────────────────────────────────────────

function SessionRow({
  item,
  highlightId,
  onDismiss,
}: {
  item: SessionNotification;
  highlightId: string | null;
  onDismiss: (id: string) => void;
}) {
  return (
    <li
      id={`desktop-notif-${item.id}`}
      className={[
        'notifications-panel__row',
        item.tone === 'error' ? 'notifications-panel__row--error' : 'notifications-panel__row--info',
        highlightId === item.id ? 'notifications-panel__row--highlight' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="notifications-panel__text">{item.text}</p>
      <button
        type="button"
        className="notifications-panel__dismiss icon-btn-ghost app-tooltip-trigger"
        aria-label="Dismiss notification"
        data-tooltip="Dismiss"
        data-tooltip-placement="inline-start"
        onClick={() => onDismiss(item.id)}
      >
        <MaterialIcon name="close" size={12} aria-hidden />
      </button>
    </li>
  );
}

// ── Reminder row ──────────────────────────────────────────────────────────────

function reminderRowClass(row: ReminderPaneRow, nowMs: number): string {
  const classes = ['notifications-panel__row', 'notifications-panel__row--reminder'];
  if (row.reminderState === 'stale') {
    classes.push('notifications-panel__row--reminder-stale');
  } else if (row.removeState === 'remove-unavailable') {
    classes.push('notifications-panel__row--error');
  } else if (nowMs >= row.dueAtMs) {
    classes.push('notifications-panel__row--reminder-due');
  }
  return classes.join(' ');
}

function ReminderRow({
  row,
  nowMs,
  onRefreshNowMs,
  onOpen,
  onRemove,
  onSnooze,
}: {
  row: ReminderPaneRow;
  nowMs: number;
  onRefreshNowMs: () => void;
  onOpen: (noteUri: string, reminderId: string, uiCaretHint?: number) => void;
  onRemove: (noteUri: string, reminderId: string) => Promise<void>;
  onSnooze: (noteUri: string, reminderId: string, minutes: number) => Promise<void>;
}) {
  const noteName = row.displayTitle ?? reminderNoteName(row.vaultRelativePath);
  const isStale = row.reminderState === 'stale';
  const isRemoving = row.removeState === 'removing';
  const isUnavailable = row.removeState === 'remove-unavailable';

  // The reminder line + its compact (HH:MM) echo. When the cleaned line is
  // empty (the source line held only the token) the time folds onto the
  // note-name header and no second line is rendered — mirrors the GNOME body.
  const timeLabel = reminderTimeLabel(row.dueAtMs);
  const hasLine = row.displayLine.trim().length > 0;
  const headerText = hasLine ? noteName : `${noteName} (${timeLabel})`;

  // Snooze is offered only inside the T-3 window with live offsets, and never
  // on a stale or in-flight-remove row (the daemon would no-op it anyway).
  const snoozeOptions =
    isStale || isRemoving || isUnavailable
      ? []
      : snoozeMenuOptions(row.dueAtMs, nowMs);

  return (
    <li
      id={`desktop-notif-${row.id}`}
      className={reminderRowClass(row, nowMs)}
    >
      <div className="notifications-panel__reminder-top">
        <div className="notifications-panel__reminder-body">
          {/* Clickable header: note name (+ folded time) and the reminder line */}
          <button
            type="button"
            className="notifications-panel__reminder-header"
            onClick={() => onOpen(row.noteUri, row.reminderId, row.uiCaretHint)}
          >
            <span className="notifications-panel__reminder-note">{headerText}</span>
            {hasLine ? (
              <span className="notifications-panel__reminder-line muted">
                {`${row.displayLine} (${timeLabel})`}
              </span>
            ) : null}
          </button>

          {/* Status line */}
          <ReminderStatusLine
            row={row}
            nowMs={nowMs}
            onOpen={onOpen}
          />
        </div>

        {/* Remove / retry actions */}
        <div className="notifications-panel__reminder-actions">
          {isUnavailable ? (
            <>
              <button
                type="button"
                className="notifications-panel__reminder-action-btn small app-tooltip-trigger"
                data-tooltip="Retry remove"
                data-tooltip-placement="inline-start"
                onClick={() => void onRemove(row.noteUri, row.reminderId)}
              >
                Retry
              </button>
              <button
                type="button"
                className="notifications-panel__dismiss icon-btn-ghost app-tooltip-trigger"
                aria-label="Open note"
                data-tooltip="Open note"
                data-tooltip-placement="inline-start"
                onClick={() => onOpen(row.noteUri, row.reminderId, row.uiCaretHint)}
              >
                <MaterialIcon name="open_in_new" size={12} aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="notifications-panel__dismiss icon-btn-ghost app-tooltip-trigger"
              aria-label={isRemoving ? 'Removing…' : 'Remove reminder'}
              data-tooltip={isRemoving ? 'Removing…' : 'Remove'}
              data-tooltip-placement="inline-start"
              disabled={isRemoving || isStale}
              onClick={() => void onRemove(row.noteUri, row.reminderId)}
            >
              {isRemoving ? (
                <MaterialIcon name="hourglass_empty" size={12} aria-hidden />
              ) : (
                <MaterialIcon name="close" size={12} aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>

      {snoozeOptions.length > 0 ? (
        <div className="notifications-panel__reminder-snooze">
          <SnoozeMenu
            options={snoozeOptions}
            onOpenChange={open => {
              if (open) onRefreshNowMs();
            }}
            onSnooze={minutes => {
              if (!snoozeMenuOptions(row.dueAtMs, Date.now()).includes(minutes)) {
                return;
              }
              void onSnooze(row.noteUri, row.reminderId, minutes);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Compact `[Snooze ▾]` dropdown offering the live snooze offsets. Built on the
 * shared Radix `DropdownMenu` so it is keyboard-navigable and dismissible
 * (Escape / outside click) for free.
 */
function SnoozeMenu({
  options,
  onOpenChange,
  onSnooze,
}: {
  options: readonly SnoozeMinutes[];
  onOpenChange: (open: boolean) => void;
  onSnooze: (minutes: SnoozeMinutes) => void;
}) {
  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="notifications-panel__reminder-action-btn small app-tooltip-trigger"
          aria-label="Snooze reminder"
          aria-haspopup="menu"
          data-tooltip="Snooze"
          data-tooltip-placement="inline-start"
        >
          Snooze ▾
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="notifications-panel__snooze-menu note-list-context-menu"
          sideOffset={4}
          align="end"
          collisionPadding={8}
        >
          {options.map(minutes => (
            <DropdownMenu.Item
              key={minutes}
              className="note-list-context-menu__item"
              onSelect={() => onSnooze(minutes)}
            >
              {snoozeOptionLabel(minutes)}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ReminderStatusLine({
  row,
  nowMs,
  onOpen,
}: {
  row: ReminderPaneRow;
  nowMs: number;
  onOpen: (noteUri: string, reminderId: string, uiCaretHint?: number) => void;
}) {
  if (row.reminderState === 'stale') {
    return (
      <p className="notifications-panel__reminder-status notifications-panel__reminder-status--stale small muted">
        {"Couldn't remove safely — "}
        <button
          type="button"
          className="notifications-panel__reminder-link"
          onClick={() => onOpen(row.noteUri, row.reminderId, row.uiCaretHint)}
        >
          open the note
        </button>
      </p>
    );
  }
  if (row.removeState === 'remove-unavailable') {
    return (
      <p className="notifications-panel__reminder-status notifications-panel__reminder-status--unavailable small muted">
        {"Couldn't reach the reminder service"}
      </p>
    );
  }
  if (row.snoozeUnavailableHint) {
    return (
      <p className="notifications-panel__reminder-status notifications-panel__reminder-status--unavailable small muted">
        {REMINDER_SNOOZE_UNAVAILABLE_TEXT}
      </p>
    );
  }
  return (
    <p className="notifications-panel__reminder-status small muted">
      {reminderDueLabel(row.dueAtMs, nowMs)}
    </p>
  );
}
