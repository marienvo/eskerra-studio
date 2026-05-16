import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {EskerraSettings, ThemePreference, VaultFilesystem} from '@eskerra/core';
import * as core from '@eskerra/core';

import {writeVaultSettings} from '../lib/vaultBootstrap';

import {useThemePreference} from './useThemePreference';

vi.mock('../lib/vaultBootstrap', () => ({
  writeVaultSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/desktopR2Transport', () => ({
  desktopR2SignedTransport: {},
}));

const fs = {} as VaultFilesystem;

const nonR2Settings: EskerraSettings = {
  themePreference: {themeId: 'eskerra-default', mode: 'light'},
};

const r2Settings: EskerraSettings = {
  r2: {
    endpoint: 'https://example.r2.cloudflarestorage.com',
    bucket: 'b',
    accessKeyId: 'a',
    secretAccessKey: 's',
  },
};

describe('useThemePreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeVaultSettings).mockResolvedValue(undefined);
    vi.spyOn(core, 'getR2ThemePreferenceObject').mockResolvedValue({
      themeId: 'eskerra-default',
      mode: 'dark',
    });
    vi.spyOn(core, 'putR2ThemePreferenceObject').mockResolvedValue(undefined);
  });

  it('non-R2 persist writes to disk before updating vault settings', async () => {
    const order: string[] = [];
    vi.mocked(writeVaultSettings).mockImplementation(async () => {
      order.push('write');
    });
    const setVaultSettings = vi.fn(() => {
      order.push('set');
    });

    const {result} = renderHook(() =>
      useThemePreference({
        vaultRoot: '/vault',
        vaultSettings: nonR2Settings,
        setVaultSettings,
        fs,
      }),
    );

    await act(async () => {
      await result.current.persistPreference({themeId: 'other', mode: 'dark'});
    });

    expect(order).toEqual(['write', 'set']);
    expect(setVaultSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        themePreference: {themeId: 'other', mode: 'dark'},
      }),
    );
  });

  it('non-R2 persist does not update vault settings when write fails', async () => {
    vi.mocked(writeVaultSettings).mockRejectedValueOnce(new Error('disk'));
    const setVaultSettings = vi.fn();

    const {result} = renderHook(() =>
      useThemePreference({
        vaultRoot: '/vault',
        vaultSettings: nonR2Settings,
        setVaultSettings,
        fs,
      }),
    );

    await expect(
      act(async () => {
        await result.current.persistPreference({themeId: 'x', mode: 'auto'});
      }),
    ).rejects.toThrow('disk');

    expect(setVaultSettings).not.toHaveBeenCalled();
  });

  it('R2 path sets preferenceLoaded after fetch', async () => {
    const setVaultSettings = vi.fn();

    const {result} = renderHook(() =>
      useThemePreference({
        vaultRoot: '/vault',
        vaultSettings: r2Settings,
        setVaultSettings,
        fs,
      }),
    );

    expect(result.current.preferenceLoaded).toBe(false);

    await waitFor(() => {
      expect(result.current.preferenceLoaded).toBe(true);
    });

    expect(core.getR2ThemePreferenceObject).toHaveBeenCalled();
    expect(result.current.preference.themeId).toBe('eskerra-default');
    expect(result.current.preference.mode).toBe('dark');
  });

  it('R2 keeps initialPreference when remote preference is null', async () => {
    vi.spyOn(core, 'getR2ThemePreferenceObject').mockResolvedValue(null);
    const initial: ThemePreference = {themeId: 'ember', mode: 'light'};

    const {result} = renderHook(() =>
      useThemePreference({
        vaultRoot: '/vault',
        vaultSettings: r2Settings,
        setVaultSettings: vi.fn(),
        fs,
        initialPreference: initial,
      }),
    );

    await waitFor(() => {
      expect(result.current.preferenceLoaded).toBe(true);
    });

    expect(result.current.preference).toEqual(initial);
  });

  it('R2 keeps initialPreference when remote fetch fails', async () => {
    vi.spyOn(core, 'getR2ThemePreferenceObject').mockRejectedValue(new Error('network'));
    const initial: ThemePreference = {themeId: 'blossom', mode: 'auto'};

    const {result} = renderHook(() =>
      useThemePreference({
        vaultRoot: '/vault',
        vaultSettings: r2Settings,
        setVaultSettings: vi.fn(),
        fs,
        initialPreference: initial,
      }),
    );

    await waitFor(() => {
      expect(result.current.preferenceLoaded).toBe(true);
    });

    expect(result.current.preference).toEqual(initial);
  });
});
