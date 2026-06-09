import {useCallback, type MutableRefObject} from 'react';
import type {VaultFilesystem} from '@eskerra/core';

import {useLiveRef} from '../../hooks/useLiveRef';
import {useCalendarPipelineTrigger} from '../../hooks/useCalendarPipelineTrigger';
import type {PaneVisibilityController} from '../usePaneVisibility';
import {useAppGitSyncOrchestration} from '../useAppGitSyncOrchestration';
import {useAppMainWindowKeyboardEffects} from '../useAppMainWindowKeyboardEffects';
import {useAppNotificationSession} from '../useAppNotificationSession';
import type {AppStatusBarCenter} from '../../lib/resolveAppStatusBarCenter';
import type {useDesktopPodcastPlayback} from '../../hooks/useDesktopPodcastPlayback';

type UseAppMainWindowChromeSessionArgs = {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  vaultMarkdownRefs: readonly {uri: string; name: string}[];
  busy: boolean;
  canReopenClosedEditorTab: boolean;
  reopenLastClosedEditorTab: () => void;
  composingNewEntry: boolean;
  selectedUri: string | null;
  onCleanNoteInbox: () => void;
  quickOpenOpen: boolean;
  setQuickOpenOpen: (open: boolean) => void;
  vaultSearchOpen: boolean;
  setVaultSearchOpen: (open: boolean) => void;
  onAddEntry: () => void;
  err: string | null;
  diskConflict: unknown;
  diskConflictSoft: {uri: string} | null;
  statusBarCenter: AppStatusBarCenter;
  renameLinkProgress: {done: number; total: number} | null;
  saveSettledNonce: number;
  desktopPlaybackRef: MutableRefObject<ReturnType<typeof useDesktopPodcastPlayback>>;
  flushInboxSave: () => void | Promise<void>;
  setPaneVisibility: PaneVisibilityController['setVisibility'];
};

export function useAppMainWindowChromeSession({
  vaultRoot,
  fs,
  vaultMarkdownRefs,
  busy,
  canReopenClosedEditorTab,
  reopenLastClosedEditorTab,
  composingNewEntry,
  selectedUri,
  onCleanNoteInbox,
  quickOpenOpen,
  setQuickOpenOpen,
  vaultSearchOpen,
  setVaultSearchOpen,
  onAddEntry,
  err,
  diskConflict,
  diskConflictSoft,
  statusBarCenter,
  renameLinkProgress,
  saveSettledNonce,
  desktopPlaybackRef,
  flushInboxSave,
  setPaneVisibility,
}: UseAppMainWindowChromeSessionArgs) {
  const openNotificationsPanel = useCallback(
    () => setPaneVisibility({notifications: true}),
    [setPaneVisibility],
  );

  const notifications = useAppNotificationSession({
    err,
    diskConflict,
    diskConflictSoft,
    selectedUri,
    statusBarCenter,
    renameLinkProgress,
    openNotificationsPanel,
  });
  const calendarSync = useCalendarPipelineTrigger(vaultRoot, fs, vaultMarkdownRefs);

  const gitSync = useAppGitSyncOrchestration({
    vaultPath: vaultRoot,
    saveSettledNonce,
    notify: notifications.pushItem,
    desktopPlaybackRef,
    flushInboxSave,
    runBeforeGitSync: calendarSync.runCalendarSync,
  });

  // Keep a ref to gitStatusForDisplay so keyboard effects can check preflight
  // without re-registering the listener on every status update.
  const gitStatusRef = useLiveRef(gitSync.gitStatusForDisplay);

  useAppMainWindowKeyboardEffects({
    vaultRoot,
    busy,
    canReopenClosedEditorTab,
    reopenLastClosedEditorTab,
    composingNewEntry,
    selectedUri,
    onCleanNoteInbox,
    quickOpenOpen,
    setQuickOpenOpen,
    vaultSearchOpen,
    setVaultSearchOpen,
    onAddEntry,
    manualSyncDisabled: gitSync.manualSyncUnavailable,
    manualSyncRunning: gitSync.manualGitSync.running,
    onManualSync: gitSync.manualGitSync.run,
    gitStatusRef,
  });

  return {
    notifications,
    calendarSync,
    gitSync,
  };
}
