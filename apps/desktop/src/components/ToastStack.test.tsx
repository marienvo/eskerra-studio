import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {SESSION_NOTIF_RENAME_PROGRESS_ID} from '../lib/sessionNotifications';
import type {SessionNotification} from '../lib/sessionNotifications';
import {ToastStack} from './ToastStack';

function renameProgressNotification(text: string): SessionNotification {
  return {
    id: SESSION_NOTIF_RENAME_PROGRESS_ID,
    tone: 'info',
    text,
    source: 'renameProgress',
  };
}

describe('ToastStack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('remounts rename-progress bar when in-place text changes', () => {
    const onDismiss = vi.fn();

    const {rerender} = render(<ToastStack items={[]} onDismiss={onDismiss} />);

    act(() => {
      rerender(
        <ToastStack
          items={[renameProgressNotification('Renaming 1 of 3…')]}
          onDismiss={onDismiss}
        />,
      );
    });

    const firstBar = document.body.querySelector('.toast__progress-bar');
    expect(firstBar).not.toBeNull();

    act(() => {
      rerender(
        <ToastStack
          items={[renameProgressNotification('Renaming 2 of 3…')]}
          onDismiss={onDismiss}
        />,
      );
    });

    const secondBar = document.body.querySelector('.toast__progress-bar');
    expect(secondBar).not.toBeNull();
    expect(secondBar).not.toBe(firstBar);
  });

  it('re-surfaces rename-progress toast after expiration when text updates', () => {
    const onDismiss = vi.fn();

    const {rerender} = render(<ToastStack items={[]} onDismiss={onDismiss} />);

    act(() => {
      rerender(
        <ToastStack
          items={[renameProgressNotification('Renaming 1 of 3…')]}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(document.body.querySelector('.toast__text')?.textContent).toBe(
      'Renaming 1 of 3…',
    );

    act(() => {
      vi.advanceTimersByTime(10_001);
    });

    expect(document.body.querySelector('.toast-stack')).toBeNull();

    act(() => {
      rerender(
        <ToastStack
          items={[renameProgressNotification('Renaming 1 of 5…')]}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(document.body.querySelector('.toast__text')?.textContent).toBe(
      'Renaming 1 of 5…',
    );

    act(() => {
      vi.advanceTimersByTime(10_001);
    });

    expect(document.body.querySelector('.toast-stack')).toBeNull();
  });

  it('does not flash seeded rename-progress backlog on mount', () => {
    const onDismiss = vi.fn();

    render(
      <ToastStack
        items={[renameProgressNotification('Renaming 2 of 5…')]}
        onDismiss={onDismiss}
      />,
    );

    expect(document.body.querySelector('.toast-stack')).toBeNull();
  });
});
