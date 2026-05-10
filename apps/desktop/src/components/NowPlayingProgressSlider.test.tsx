import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {NowPlayingProgressSlider} from './NowPlayingProgressSlider';

describe('NowPlayingProgressSlider', () => {
  it('reflects position and duration on the range control', () => {
    render(
      <NowPlayingProgressSlider
        disabled={false}
        durationMs={60_000}
        onSeek={vi.fn()}
        positionMs={30_000}
      />,
    );

    const input = screen.getByRole('slider', {name: 'Playback progress'}) as HTMLInputElement;
    expect(input.getAttribute('max')).toBe('60000');
    expect(Number(input.value)).toBe(30_000);
  });

  it('commits once on pointer release after scrubbing, not on intermediate input events', () => {
    const onSeek = vi.fn();
    render(
      <NowPlayingProgressSlider
        disabled={false}
        durationMs={60_000}
        onSeek={onSeek}
        positionMs={30_000}
      />,
    );

    const input = screen.getByRole('slider', {name: 'Playback progress'});
    fireEvent.pointerDown(input);
    fireEvent.input(input, {target: {value: '40000'}});
    fireEvent.input(input, {target: {value: '50000'}});
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.pointerUp(input);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(50_000);
  });

  it('disables the input when disabled or duration is zero', () => {
    const {rerender} = render(
      <NowPlayingProgressSlider
        disabled
        durationMs={60_000}
        onSeek={vi.fn()}
        positionMs={0}
      />,
    );

    let input = screen.getByRole('slider', {name: 'Playback progress'}) as HTMLInputElement;
    expect(input.disabled).toBe(true);

    rerender(
      <NowPlayingProgressSlider
        disabled={false}
        durationMs={0}
        onSeek={vi.fn()}
        positionMs={5000}
      />,
    );

    input = screen.getByRole('slider', {name: 'Playback progress'}) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(Number(input.value)).toBe(0);
  });
});
