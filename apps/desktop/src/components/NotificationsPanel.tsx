import {useEffect, useState} from 'react';

import type {SessionNotification} from '../lib/sessionNotifications';
import type {PaneNotification, ReminderPaneRow} from '../lib/reminderPane';
import {reminderNoteName, reminderDueLabel} from '../lib/reminderPane';

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
};

export function NotificationsPanel({
  appSurface,
  items,
  highlightId,
  onDismiss,
  onClearAll,
  onOpenReminder,
  onRemoveReminder,
}: NotificationsPanelProps) {
  // Minute tick so due-time labels stay current. useState(Date.now) is the
  // accepted initializer-function pattern; the setInterval callback is in an
  // effect (not during render) so it avoids the impure-function-in-render rule.
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

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
                  onOpen={onOpenReminder}
                  onRemove={onRemoveReminder}
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
  onOpen,
  onRemove,
}: {
  row: ReminderPaneRow;
  nowMs: number;
  onOpen: (noteUri: string, reminderId: string, uiCaretHint?: number) => void;
  onRemove: (noteUri: string, reminderId: string) => Promise<void>;
}) {
  const noteName = reminderNoteName(row.vaultRelativePath);
  const isStale = row.reminderState === 'stale';
  const isRemoving = row.removeState === 'removing';
  const isUnavailable = row.removeState === 'remove-unavailable';

  return (
    <li
      id={`desktop-notif-${row.id}`}
      className={reminderRowClass(row, nowMs)}
    >
      <div className="notifications-panel__reminder-body">
        {/* Clickable header: note name + token */}
        <button
          type="button"
          className="notifications-panel__reminder-header"
          onClick={() => onOpen(row.noteUri, row.reminderId, row.uiCaretHint)}
        >
          <span className="notifications-panel__reminder-note">{noteName}</span>
          <span className="notifications-panel__reminder-token muted">
            {row.normalizedTokenText}
          </span>
        </button>

        {/* Status line */}
        <ReminderStatusLine
          row={row}
          nowMs={nowMs}
          onOpen={onOpen}
        />
      </div>

      {/* Action buttons */}
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
    </li>
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
  return (
    <p className="notifications-panel__reminder-status small muted">
      {reminderDueLabel(row.dueAtMs, nowMs)}
    </p>
  );
}
