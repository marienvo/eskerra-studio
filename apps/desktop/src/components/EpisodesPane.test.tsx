import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {EpisodesPane} from './EpisodesPane';

describe('EpisodesPane header actions', () => {
  it('does not render the removed calendar refresh action', () => {
    render(
      <EpisodesPane
        sections={[]}
        catalogLoading={false}
        playEpisode={vi.fn()}
        markEpisodePlayed={vi.fn()}
        openPodcastNote={vi.fn()}
        activeEpisodeId={null}
        activeEpisodePlayControl="paused"
        onRssSync={vi.fn()}
        calendarSyncing
      />,
    );

    expect(screen.getByRole('button', {name: 'Refresh podcast feeds'})).toBeTruthy();
    expect(screen.queryByRole('button', {name: 'Refresh calendars'})).toBeNull();
  });
});
