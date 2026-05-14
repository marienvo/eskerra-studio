import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

import {AppStatusBar} from './AppStatusBar';

describe('AppStatusBar manual sync button', () => {
  it('runs the provided manual sync handler when clicked', () => {
    const onManualSync = vi.fn();
    render(
      <AppStatusBar
        onOpenSettings={vi.fn()}
        onManualSync={onManualSync}
        manualSyncLabel="Sync vault"
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Sync vault'}));

    expect(onManualSync).toHaveBeenCalledTimes(1);
  });

  it('disables the manual sync button when manual sync is disabled', () => {
    const onManualSync = vi.fn();
    render(
      <AppStatusBar
        onOpenSettings={vi.fn()}
        onManualSync={onManualSync}
        manualSyncDisabled
        manualSyncLabel="Wrong branch"
      />,
    );

    const button = screen.getByRole('button', {name: 'Wrong branch'});
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onManualSync).not.toHaveBeenCalled();
  });

  it('disables the manual sync button while manual sync is running', () => {
    const onManualSync = vi.fn();
    render(
      <AppStatusBar
        onOpenSettings={vi.fn()}
        onManualSync={onManualSync}
        manualSyncBusy
        manualSyncLabel="Sync vault"
      />,
    );

    const button = screen.getByRole('button', {name: 'Sync vault'});
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onManualSync).not.toHaveBeenCalled();
  });
});
