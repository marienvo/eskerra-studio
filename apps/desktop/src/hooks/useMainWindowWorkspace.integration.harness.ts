/**
 * Shared mount helper for `useMainWindowWorkspace` integration tests.
 * Loads {@link ./useMainWindowWorkspace.integration.mocks} first (Tauri boundaries).
 */

import './useMainWindowWorkspace.integration.mocks';

export {getDesktopMainWindowIntegrationMocks} from './useMainWindowWorkspace.integration.mocks';

import {
  act,
  renderHook,
  waitFor,
  type RenderHookResult,
} from '@testing-library/react';
import {expect} from 'vitest';

import type {VaultFilesystem} from '@eskerra/core';

import {
  createDesktopTestVaultFilesystem,
  type CreateDesktopTestVaultFilesystemOptions,
} from '../test/desktopVaultFilesystem';

import {
  type UseMainWindowWorkspaceResult,
  useMainWindowWorkspace,
} from './useMainWindowWorkspace';

const VAULT_ROOT = '/vault';

export async function mountHydratedMainWindowWorkspace(
  seed: CreateDesktopTestVaultFilesystemOptions,
): Promise<{
  fs: VaultFilesystem;
  result: RenderHookResult<UseMainWindowWorkspaceResult, unknown>;
  unmount: () => void;
}> {
  const {fs} = createDesktopTestVaultFilesystem(seed);
  const inboxEditorRef: {current: null} = {current: null};
  const inboxEditorShellScrollRef: {current: null} = {current: null};

  const hook = renderHook(() =>
    useMainWindowWorkspace({
      fs,
      inboxEditorRef,
      inboxEditorShellScrollRef,
      restoredInboxState: null,
      inboxRestoreEnabled: true,
    }),
  );

  await waitFor(() => {
    expect(hook.result.current.initialVaultHydrateAttemptDone).toBe(true);
  });

  await act(async () => {
    await hook.result.current.hydrateVault(VAULT_ROOT);
  });

  await waitFor(() => {
    expect(hook.result.current.vaultRoot).toBe(VAULT_ROOT);
  });

  return {fs, result: hook.result, unmount: hook.unmount};
}
