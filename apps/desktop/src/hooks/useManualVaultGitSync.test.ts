import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {mockAppLocalDataDir, mockJoin, mockRunVaultGitSync} = vi.hoisted(() => ({
  mockAppLocalDataDir: vi.fn(),
  mockJoin: vi.fn(),
  mockRunVaultGitSync: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appLocalDataDir: mockAppLocalDataDir,
  join: mockJoin,
}));

vi.mock('../lib/tauriVaultGitSync', () => ({
  runVaultGitSync: mockRunVaultGitSync,
}));

import type {SyncConfig, SyncRunResult} from '../lib/tauriVaultGitSync';
import {useManualVaultGitSync} from './useManualVaultGitSync';

const config: SyncConfig = {
  remote: 'origin',
  branch: 'main',
  include: ['**/*.md'],
  exclude: [],
  backupDirectory: '_sync-backups',
  conflictPolicies: [],
  markdownConflictCallout: {
    enabled: false,
    calloutKind: 'warning',
    template: '',
  },
  commitMessageTemplate: 'chore: sync',
  hostLabel: null,
  backupLocalSubdir: 'local',
  backupRemoteSubdir: 'remote',
  timeouts: {
    fetchSecs: 30,
    pushSecs: 30,
    mergeSecs: 30,
  },
  allowCreateBackupDirectory: false,
  skipCommitHooks: true,
};

const syncResult: SyncRunResult = {
  localCommit: {
    stageResult: {
      stagedPaths: [],
      excludedPaths: [],
      unsupportedPaths: [],
      mutated: false,
    },
    commit: null,
    mutated: false,
  },
  preMergeSha: null,
  pushed: true,
  snapshotBranch: null,
  finalHeadSha: 'abc123',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

describe('useManualVaultGitSync', () => {
  beforeEach(() => {
    mockAppLocalDataDir.mockReset().mockResolvedValue('/app-data');
    mockJoin.mockReset().mockResolvedValue('/app-data/locks');
    mockRunVaultGitSync.mockReset();
  });

  it('returns true after successful sync', async () => {
    const notify = vi.fn();
    const onSettled = vi.fn();
    mockRunVaultGitSync.mockResolvedValue(syncResult);

    const {result} = renderHook(() =>
      useManualVaultGitSync({vaultPath: '/vault', config, notify, onSettled}),
    );

    await expect(result.current.run()).resolves.toBe(true);

    expect(mockRunVaultGitSync).toHaveBeenCalledWith({
      vaultPath: '/vault',
      locksDir: '/app-data/locks',
      config,
    });
    expect(notify).toHaveBeenCalledWith('info', 'Vault sync complete.');
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('returns false and keeps existing error notification on failure', async () => {
    const notify = vi.fn();
    const onSettled = vi.fn();
    mockRunVaultGitSync.mockRejectedValue({type: 'pushRejected', stderr: 'rejected'});

    const {result} = renderHook(() =>
      useManualVaultGitSync({vaultPath: '/vault', config, notify, onSettled}),
    );

    await expect(result.current.run()).resolves.toBe(false);

    expect(notify).toHaveBeenCalledWith('error', 'Push rejected. Local changes remain committed.');
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('returns false without running when vault or config is unavailable', async () => {
    const {result} = renderHook(() =>
      useManualVaultGitSync({
        vaultPath: '/vault',
        config: null,
        notify: vi.fn(),
        onSettled: vi.fn(),
      }),
    );

    await expect(result.current.run()).resolves.toBe(false);

    expect(mockRunVaultGitSync).not.toHaveBeenCalled();
  });

  it('returns false without running when vault is unavailable', async () => {
    const {result} = renderHook(() =>
      useManualVaultGitSync({
        vaultPath: null,
        config,
        notify: vi.fn(),
        onSettled: vi.fn(),
      }),
    );

    await expect(result.current.run()).resolves.toBe(false);

    expect(mockRunVaultGitSync).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing when sync setup fails', async () => {
    const notify = vi.fn();
    const onSettled = vi.fn();
    mockAppLocalDataDir.mockRejectedValue(new Error('path unavailable'));
    const {result} = renderHook(() =>
      useManualVaultGitSync({
        vaultPath: '/vault',
        config,
        notify,
        onSettled,
      }),
    );

    await expect(result.current.run()).resolves.toBe(false);

    expect(notify).toHaveBeenCalledWith('error', 'path unavailable');
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('does not notify success when silent is true', async () => {
    const notify = vi.fn();
    mockRunVaultGitSync.mockResolvedValue(syncResult);

    const {result} = renderHook(() =>
      useManualVaultGitSync({vaultPath: '/vault', config, notify, onSettled: vi.fn()}),
    );

    await expect(result.current.run({silent: true})).resolves.toBe(true);

    expect(notify).not.toHaveBeenCalledWith('info', expect.any(String));
  });

  it('still notifies error when silent is true and sync fails', async () => {
    const notify = vi.fn();
    mockRunVaultGitSync.mockRejectedValue({type: 'pushRejected', stderr: 'rejected'});

    const {result} = renderHook(() =>
      useManualVaultGitSync({vaultPath: '/vault', config, notify, onSettled: vi.fn()}),
    );

    await expect(result.current.run({silent: true})).resolves.toBe(false);

    expect(notify).toHaveBeenCalledWith('error', 'Push rejected. Local changes remain committed.');
  });

  it('does not start duplicate concurrent sync runs', async () => {
    const pending = deferred<SyncRunResult>();
    mockRunVaultGitSync.mockReturnValue(pending.promise);
    const {result} = renderHook(() =>
      useManualVaultGitSync({
        vaultPath: '/vault',
        config,
        notify: vi.fn(),
        onSettled: vi.fn(),
      }),
    );

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.run();
      second = result.current.run();
    });

    await expect(second).resolves.toBe(false);
    expect(mockRunVaultGitSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(syncResult);
      await first;
    });
  });
});
