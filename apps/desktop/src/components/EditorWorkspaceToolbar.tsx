import {
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  ListBulletIcon,
} from '@radix-ui/react-icons';

import type {PlaybackTransportProps} from './PlaybackTransport';
import {PlaybackTransport} from './PlaybackTransport';
import {MaterialIcon} from './MaterialIcon';
import {NowPlayingProgressSlider} from './NowPlayingProgressSlider';
import {cleanNoteMenuShortcutLabel} from '../lib/desktopShortcutLabels';

const EDITOR_TOOLBAR_ICON_DIM = {width: 15, height: 15} as const;

export type EditorWorkspaceToolbarNowPlayingProgress = {
  positionMs: number;
  durationMs: number;
  disabled: boolean;
  onSeek: (ms: number) => void;
};

export type EditorWorkspaceToolbarNowPlaying = {
  episodeTitle: string;
  seriesName: string;
  /** Removes the active episode from the playlist without marking it as listened. */
  onClose: () => void;
  progress: EditorWorkspaceToolbarNowPlayingProgress;
};

export type EditorWorkspaceToolbarProps = {
  vaultPaneVisible: boolean;
  onToggleVault: () => void;
  episodesPaneVisible: boolean;
  onToggleEpisodes: () => void;
  inboxPaneVisible: boolean;
  onToggleInboxPane: () => void;
  busy: boolean;
  editorHistoryCanGoBack: boolean;
  editorHistoryCanGoForward: boolean;
  onEditorHistoryGoBack: () => void;
  onEditorHistoryGoForward: () => void;
  composingNewEntry: boolean;
  editorPaneTitle: string;
  onCancelNewEntry: () => void;
  notificationsPanelVisible: boolean;
  onToggleNotificationsPanel: () => void;
  /** When true, show a red indicator dot on the Inbox toggle (≥1 eligible markdown under `Inbox/`). */
  inboxHasItems: boolean;
  /** When true, show a red indicator dot on the Notifications toggle (≥1 session notification). */
  notificationsHasItems: boolean;
  /** When set and not composing, shown after Back/Forward with spacing, then {@link nowPlaying}. */
  playbackTransport?: PlaybackTransportProps;
  nowPlaying?: EditorWorkspaceToolbarNowPlaying | null;
  /** Markdown layout normalize for the open note; omitted when unavailable (e.g. composing). */
  onCleanNote?: () => void;
};

/**
 * Full-width chrome above the main workspace split (vault / episodes / editor + inbox tree + notifications).
 * Open-note tabs render in the window title bar, not here.
 */
export function EditorWorkspaceToolbar({
  vaultPaneVisible,
  onToggleVault,
  episodesPaneVisible,
  onToggleEpisodes,
  inboxPaneVisible,
  onToggleInboxPane,
  busy,
  editorHistoryCanGoBack,
  editorHistoryCanGoForward,
  onEditorHistoryGoBack,
  onEditorHistoryGoForward,
  composingNewEntry,
  editorPaneTitle,
  onCancelNewEntry,
  notificationsPanelVisible,
  onToggleNotificationsPanel,
  inboxHasItems,
  notificationsHasItems,
  playbackTransport,
  nowPlaying,
  onCleanNote,
}: EditorWorkspaceToolbarProps) {
  const showPlaybackChrome =
    !composingNewEntry && playbackTransport != null && nowPlaying != null;
  let toolbarCenter = null;
  if (composingNewEntry) {
    toolbarCenter = (
      <span className="pane-title pane-title--truncate" title={editorPaneTitle}>
        {editorPaneTitle}
      </span>
    );
  } else if (showPlaybackChrome) {
    toolbarCenter = (
      <>
        <span className="editor-workspace-toolbar__playback-gap" aria-hidden />
        <PlaybackTransport {...playbackTransport} variant="toolbar" />
      </>
    );
  }

  return (
    <div
      className={[
        'pane-header pane-header--editor-toolbar editor-workspace-toolbar',
        showPlaybackChrome ? 'editor-workspace-toolbar--playback' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="pane-header-start">
        <button
          type="button"
          className={[
            'pane-header-add-btn icon-btn-ghost app-tooltip-trigger',
            vaultPaneVisible ? 'pane-header-add-btn--vault-on' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onToggleVault}
          aria-label="Vault"
          aria-pressed={vaultPaneVisible}
          data-tooltip="Vault"
          data-tooltip-placement="inline-end"
        >
          <span className="pane-header-add-btn__glyph" aria-hidden>
            <ListBulletIcon {...EDITOR_TOOLBAR_ICON_DIM} />
          </span>
        </button>
        <button
          type="button"
          className={[
            'pane-header-add-btn icon-btn-ghost app-tooltip-trigger',
            episodesPaneVisible ? 'pane-header-add-btn--episodes-on' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onToggleEpisodes}
          aria-label="Episodes pane"
          aria-pressed={episodesPaneVisible}
          data-tooltip="Episodes"
          data-tooltip-placement="inline-end"
        >
          <span className="pane-header-add-btn__glyph" aria-hidden>
            <MaterialIcon name="radio" size={12} />
          </span>
        </button>
        <button
          type="button"
          className="pane-header-add-btn icon-btn-ghost app-tooltip-trigger"
          onClick={onEditorHistoryGoBack}
          disabled={busy || !editorHistoryCanGoBack}
          aria-label="Back"
          data-tooltip="Back"
          data-tooltip-placement="inline-end"
        >
          <span className="pane-header-add-btn__glyph" aria-hidden>
            <ChevronLeftIcon {...EDITOR_TOOLBAR_ICON_DIM} />
          </span>
        </button>
        <button
          type="button"
          className="pane-header-add-btn icon-btn-ghost app-tooltip-trigger"
          onClick={onEditorHistoryGoForward}
          disabled={busy || !editorHistoryCanGoForward}
          aria-label="Forward"
          data-tooltip="Forward"
          data-tooltip-placement="inline-end"
        >
          <span className="pane-header-add-btn__glyph" aria-hidden>
            <ChevronRightIcon {...EDITOR_TOOLBAR_ICON_DIM} />
          </span>
        </button>
        {toolbarCenter}
      </div>
      {showPlaybackChrome ? (
        <p
          className="editor-workspace-toolbar__now-playing pane-title pane-title--truncate"
          title={`${nowPlaying.episodeTitle} — ${nowPlaying.seriesName}`}
        >
          <button
            type="button"
            className="editor-workspace-toolbar__close-now-playing pane-header-add-btn icon-btn-ghost app-tooltip-trigger"
            onClick={nowPlaying.onClose}
            aria-label="Close podcast"
            data-tooltip="Close podcast"
            data-tooltip-placement="inline-end"
          >
            <span className="editor-workspace-toolbar__close-now-playing-glyph" aria-hidden>
              <Cross2Icon width={13} height={13} />
            </span>
          </button>
          <span className="editor-workspace-toolbar__now-playing-inner">
            <strong>{nowPlaying.episodeTitle}</strong>
            <span className="editor-workspace-toolbar__now-playing-series muted">
              {' '}
              — {nowPlaying.seriesName}
            </span>
          </span>
          <NowPlayingProgressSlider {...nowPlaying.progress} />
        </p>
      ) : null}
      <div className="pane-header-trailing-actions">
        {onCleanNote ? (
          <button
            type="button"
            className="pane-header-add-btn icon-btn-ghost app-tooltip-trigger"
            onClick={onCleanNote}
            disabled={busy}
            aria-label="Clean this note"
            data-tooltip={`Clean this note (${cleanNoteMenuShortcutLabel()})`}
            data-tooltip-placement="inline-start"
          >
            <span className="pane-header-add-btn__glyph" aria-hidden>
              <MaterialIcon name="auto_fix_high" size={12} />
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className={[
            'pane-header-add-btn icon-btn-ghost app-tooltip-trigger',
            inboxPaneVisible ? 'pane-header-add-btn--inbox-on' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onToggleInboxPane}
          aria-label={inboxHasItems ? 'Inbox tree pane (has notes)' : 'Inbox tree pane'}
          aria-pressed={inboxPaneVisible}
          data-tooltip="Inbox"
          data-tooltip-placement="inline-start"
        >
          <span className="pane-header-add-btn__glyph-wrap">
            <span className="pane-header-add-btn__glyph" aria-hidden>
              <MaterialIcon name="inbox" size={12} />
            </span>
            {inboxHasItems ? (
              <span className="pane-header-add-btn__badge-dot" aria-hidden />
            ) : null}
          </span>
        </button>
        {composingNewEntry ? (
          <button
            type="button"
            className="pane-header-add-btn icon-btn-ghost app-tooltip-trigger"
            onClick={onCancelNewEntry}
            disabled={busy}
            aria-label="Cancel new entry"
            data-tooltip="Cancel"
            data-tooltip-placement="inline-start"
          >
            <span className="pane-header-add-btn__glyph" aria-hidden>
              <Cross2Icon {...EDITOR_TOOLBAR_ICON_DIM} />
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className={[
            'pane-header-add-btn icon-btn-ghost app-tooltip-trigger',
            notificationsPanelVisible ? 'pane-header-add-btn--notifications-on' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onToggleNotificationsPanel}
          aria-label={
            notificationsHasItems ? 'Notifications (unread)' : 'Notifications'
          }
          aria-pressed={notificationsPanelVisible}
          data-tooltip="Notifications"
          data-tooltip-placement="inline-start"
        >
          <span className="pane-header-add-btn__glyph-wrap">
            <span className="pane-header-add-btn__glyph" aria-hidden>
              <BellIcon {...EDITOR_TOOLBAR_ICON_DIM} />
            </span>
            {notificationsHasItems ? (
              <span className="pane-header-add-btn__badge-dot" aria-hidden />
            ) : null}
          </span>
        </button>
      </div>
    </div>
  );
}
