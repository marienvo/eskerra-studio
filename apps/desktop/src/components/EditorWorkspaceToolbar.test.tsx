import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import type {PlaybackTransportProps} from './PlaybackTransport';
import {EditorWorkspaceToolbar} from './EditorWorkspaceToolbar';

const transport: PlaybackTransportProps = {
  durationLabel: '1:00',
  onSeekBack: vi.fn(),
  onSeekForward: vi.fn(),
  onTogglePlay: vi.fn(),
  playControl: 'paused',
  positionLabel: '0:00',
  seekDisabled: false,
};

const baseProps = {
  busy: false,
  composingNewEntry: false,
  editorHistoryCanGoBack: false,
  editorHistoryCanGoForward: false,
  editorPaneTitle: 'Note',
  episodesPaneVisible: true,
  inboxHasItems: false,
  inboxPaneVisible: false,
  notificationsHasItems: false,
  notificationsPanelVisible: false,
  onCancelNewEntry: vi.fn(),
  onEditorHistoryGoBack: vi.fn(),
  onEditorHistoryGoForward: vi.fn(),
  onToggleEpisodes: vi.fn(),
  onToggleInboxPane: vi.fn(),
  onToggleNotificationsPanel: vi.fn(),
  onToggleVault: vi.fn(),
  vaultPaneVisible: true,
};

describe('EditorWorkspaceToolbar close now playing', () => {
  it('renders close control before the title when now playing', () => {
    const onClose = vi.fn();
    render(
      <EditorWorkspaceToolbar
        {...baseProps}
        playbackTransport={transport}
        nowPlaying={{
          episodeTitle: 'My episode',
          onClose,
          seriesName: 'My show',
        }}
      />,
    );

    const closeBtn = screen.getByRole('button', {name: 'Close podcast'});
    expect(closeBtn.compareDocumentPosition(screen.getByText('My episode'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits close when now playing is absent', () => {
    render(
      <EditorWorkspaceToolbar
        {...baseProps}
        playbackTransport={transport}
        nowPlaying={null}
      />,
    );

    expect(screen.queryByRole('button', {name: 'Close podcast'})).toBeNull();
  });

  it('omits close in compose mode', () => {
    render(
      <EditorWorkspaceToolbar
        {...baseProps}
        composingNewEntry
        playbackTransport={transport}
        nowPlaying={{
          episodeTitle: 'Hidden',
          onClose: vi.fn(),
          seriesName: 'Show',
        }}
      />,
    );

    expect(screen.queryByRole('button', {name: 'Close podcast'})).toBeNull();
  });
});
