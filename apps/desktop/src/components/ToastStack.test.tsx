import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {SESSION_NOTIF_RENAME_PROGRESS_ID} from '../lib/sessionNotifications';
import type {SessionNotification} from '../lib/sessionNotifications';
import {ToastStack} from './ToastStack';

describe('ToastStack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('remounts rename-progress bar when in-place text changes', () => {
    const onDismiss = vi.fn();
    const renameProgress = (text: string): SessionNotification => ({
      id: SESSION_NOTIF_RENAME_PROGRESS_ID,
      tone: 'info',
      text,
      source: 'renameProgress',
    });

    const {rerender} = render(<ToastStack items={[]} onDismiss={onDismiss} />);

    act(() => {
      rerender(
        <ToastStack
          items={[renameProgress('Renaming 1 of 3…')]}
          onDismiss={onDismiss}
        />,
      );
    });

    const firstBar = document.body.querySelector('.toast__progress-bar');
    expect(firstBar).not.toBeNull();

    act(() => {
      rerender(
        <ToastStack
          items={[renameProgress('Renaming 2 of 3…')]}
          onDismiss={onDismiss}
        />,
      );
    });

    const secondBar = document.body.querySelector('.toast__progress-bar');
    expect(secondBar).not.toBeNull();
    expect(secondBar).not.toBe(firstBar);
  });
});
