import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {useAppPickFolder} from './useAppPickFolder';

const openMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
}));

describe('useAppPickFolder', () => {
  beforeEach(() => {
    openMock.mockReset();
  });

  it('hydrates vault and switches to vault page when folder is picked', async () => {
    openMock.mockResolvedValue('/vault');
    const setErr = vi.fn();
    const hydrateVault = vi.fn().mockResolvedValue(undefined);
    const setActivePage = vi.fn();
    const {result} = renderHook(() =>
      useAppPickFolder({setErr, hydrateVault, setActivePage}),
    );

    await act(async () => {
      await result.current();
    });

    expect(setErr).toHaveBeenCalledWith(null);
    expect(hydrateVault).toHaveBeenCalledWith('/vault');
    expect(setActivePage).toHaveBeenCalledWith('vault');
  });

  it('does nothing after clearing error when picker is cancelled', async () => {
    openMock.mockResolvedValue(null);
    const setErr = vi.fn();
    const hydrateVault = vi.fn();
    const setActivePage = vi.fn();
    const {result} = renderHook(() =>
      useAppPickFolder({setErr, hydrateVault, setActivePage}),
    );

    await act(async () => {
      await result.current();
    });

    expect(setErr).toHaveBeenCalledWith(null);
    expect(hydrateVault).not.toHaveBeenCalled();
    expect(setActivePage).not.toHaveBeenCalled();
  });
});
