import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {VaultFilesystem, VaultThemeListItem} from '@eskerra/core';
import * as core from '@eskerra/core';

import {useVaultThemes} from './useVaultThemes';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const fs = {} as VaultFilesystem;

const startupVaultItem: VaultThemeListItem = {
  kind: 'ok',
  theme: {
    id: 'my-vault-theme',
    name: 'My Vault Theme',
    source: 'vault',
    light: {palette: ['#F5F5F5']},
    dark: {palette: ['#111111']},
    fileName: 'my-vault-theme.json',
  },
};

describe('useVaultThemes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps initialItems when vaultRoot is null and initialItems is non-empty', async () => {
    const listSpy = vi.spyOn(core, 'listVaultThemes').mockResolvedValue([]);

    const {result} = renderHook(() =>
      useVaultThemes({
        vaultRoot: null,
        fs,
        initialItems: [startupVaultItem],
      }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.items).toEqual([startupVaultItem]);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('clears items when vaultRoot is null and initialItems is empty', async () => {
    const listSpy = vi.spyOn(core, 'listVaultThemes').mockResolvedValue([]);

    const {result} = renderHook(() =>
      useVaultThemes({
        vaultRoot: null,
        fs,
        initialItems: [],
      }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(result.current.items).toEqual([]);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('clears items when vaultRoot returns to null after a vault load', async () => {
    const fromDisk: VaultThemeListItem[] = [
      {
        kind: 'ok',
        theme: {
          id: 'disk-theme',
          name: 'Disk',
          source: 'vault',
          light: {palette: ['#eeeeee']},
          dark: {palette: ['#222222']},
          fileName: 'disk-theme.json',
        },
      },
    ];
    const listSpy = vi.spyOn(core, 'listVaultThemes').mockResolvedValue(fromDisk);

    const {result, rerender} = renderHook(
      ({vaultRoot}: {vaultRoot: string | null}) =>
        useVaultThemes({
          vaultRoot,
          fs,
          initialItems: [startupVaultItem],
        }),
      {initialProps: {vaultRoot: null as string | null}},
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.items).toEqual([startupVaultItem]);

    rerender({vaultRoot: '/vault'});
    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith('/vault', fs);
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(fromDisk);
    });

    rerender({vaultRoot: null});
    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });
  });

  it('loads from disk when vaultRoot becomes set', async () => {
    const fromDisk: VaultThemeListItem[] = [
      {
        kind: 'ok',
        theme: {
          id: 'disk-theme',
          name: 'Disk',
          source: 'vault',
          light: {palette: ['#eeeeee']},
          dark: {palette: ['#222222']},
          fileName: 'disk-theme.json',
        },
      },
    ];
    const listSpy = vi.spyOn(core, 'listVaultThemes').mockResolvedValue(fromDisk);

    const {result, rerender} = renderHook(
      ({vaultRoot}: {vaultRoot: string | null}) =>
        useVaultThemes({
          vaultRoot,
          fs,
          initialItems: [startupVaultItem],
        }),
      {initialProps: {vaultRoot: null as string | null}},
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.items).toEqual([startupVaultItem]);

    rerender({vaultRoot: '/vault'});

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith('/vault', fs);
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(fromDisk);
    });
  });

  it('manual reload with null vault clears items when initialItems ref is empty', async () => {
    vi.spyOn(core, 'listVaultThemes').mockResolvedValue([]);

    const {result} = renderHook(() =>
      useVaultThemes({
        vaultRoot: null,
        fs,
        initialItems: [],
      }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.items).toEqual([]);
  });
});
