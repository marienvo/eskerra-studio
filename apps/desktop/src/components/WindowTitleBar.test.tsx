import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockCloseDesktopMainWindow, mockIsDesktopTauriHost, mockMinimizeDesktopMainWindow} =
  vi.hoisted(() => ({
    mockCloseDesktopMainWindow: vi.fn(),
    mockIsDesktopTauriHost: vi.fn(() => true),
    mockMinimizeDesktopMainWindow: vi.fn(),
  }));

vi.mock('../lib/desktopTauriWindow', () => ({
  closeDesktopMainWindow: mockCloseDesktopMainWindow,
  isDesktopTauriHost: mockIsDesktopTauriHost,
  minimizeDesktopMainWindow: mockMinimizeDesktopMainWindow,
}));

import {WindowTitleBar} from './WindowTitleBar';

describe('WindowTitleBar close control', () => {
  beforeEach(() => {
    mockCloseDesktopMainWindow.mockReset();
    mockIsDesktopTauriHost.mockReturnValue(true);
    mockMinimizeDesktopMainWindow.mockReset();
  });

  it('requests sync-and-close by default', () => {
    const onCloseRequest = vi.fn();
    render(<WindowTitleBar onCloseRequest={onCloseRequest} />);

    fireEvent.click(screen.getByRole('button', {name: 'Sync and close'}));

    expect(onCloseRequest).toHaveBeenCalledWith({instant: false});
    expect(mockCloseDesktopMainWindow).not.toHaveBeenCalled();
  });

  it('requests instant close when Shift is held during click', () => {
    const onCloseRequest = vi.fn();
    render(<WindowTitleBar onCloseRequest={onCloseRequest} />);

    fireEvent.click(screen.getByRole('button', {name: 'Sync and close'}), {shiftKey: true});

    expect(onCloseRequest).toHaveBeenCalledWith({instant: true});
  });

  it('updates close tooltip and aria-label while Shift is held', () => {
    render(<WindowTitleBar onCloseRequest={vi.fn()} />);

    fireEvent.keyDown(window, {key: 'Shift'});

    const close = screen.getByRole('button', {name: 'Close instantly'});
    expect(close.getAttribute('data-tooltip')).toBe('Close instantly');

    fireEvent.keyUp(window, {key: 'Shift'});

    expect(screen.getByRole('button', {name: 'Sync and close'}).getAttribute('data-tooltip')).toBe(
      'Sync and close',
    );
  });

  it('shows syncing close label while sync is running', () => {
    render(<WindowTitleBar closeSyncing onCloseRequest={vi.fn()} />);

    const close = screen.getByRole('button', {name: 'Syncing before close'});
    expect(close.getAttribute('data-tooltip')).toBe('Syncing before close');
  });

  it('lets Shift held override syncing close label', () => {
    render(<WindowTitleBar closeSyncing onCloseRequest={vi.fn()} />);

    fireEvent.keyDown(window, {key: 'Shift'});

    expect(screen.getByRole('button', {name: 'Close instantly'}).getAttribute('data-tooltip')).toBe(
      'Close instantly',
    );
  });

  it('falls back to direct close when no close handler is provided', () => {
    render(<WindowTitleBar />);

    fireEvent.click(screen.getByRole('button', {name: 'Sync and close'}));

    expect(mockCloseDesktopMainWindow).toHaveBeenCalledTimes(1);
  });
});
