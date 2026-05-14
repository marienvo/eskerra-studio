import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from 'react';

import {
  initialDoubleShiftState,
  reduceDoubleShiftKeyDown,
  reduceDoubleShiftKeyUp,
} from '../lib/doubleShiftKeySequence';
import {shouldRunVaultGitSync} from '../lib/gitSyncPreflight';
import type {GitStatusResult} from '../lib/tauriVaultGitSync';

type AppMainWindowKeyboardEffectsArgs = {
  vaultRoot: string | null;
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
  manualSyncDisabled?: boolean;
  manualSyncRunning?: boolean;
  onManualSync?: () => void;
  /** Ref holding the current GitStatusResult for preflight checks. Kept as a ref to avoid re-registering the listener. */
  gitStatusRef?: MutableRefObject<GitStatusResult | null>;
};

export function useAppMainWindowKeyboardEffects({
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
  manualSyncDisabled = true,
  manualSyncRunning = false,
  onManualSync,
  gitStatusRef,
}: AppMainWindowKeyboardEffectsArgs) {
  const canReopenClosedEditorTabRef = useRef(canReopenClosedEditorTab);
  const reopenLastClosedEditorTabRef = useRef(reopenLastClosedEditorTab);
  useLayoutEffect(() => {
    canReopenClosedEditorTabRef.current = canReopenClosedEditorTab;
    reopenLastClosedEditorTabRef.current = reopenLastClosedEditorTab;
  }, [canReopenClosedEditorTab, reopenLastClosedEditorTab]);

  const onCleanNoteInboxRef = useRef(onCleanNoteInbox);
  useLayoutEffect(() => {
    onCleanNoteInboxRef.current = onCleanNoteInbox;
  }, [onCleanNoteInbox]);

  const quickOpenOpenRef = useRef(quickOpenOpen);
  const vaultSearchOpenRef = useRef(vaultSearchOpen);
  useLayoutEffect(() => {
    quickOpenOpenRef.current = quickOpenOpen;
  }, [quickOpenOpen]);
  useLayoutEffect(() => {
    vaultSearchOpenRef.current = vaultSearchOpen;
  }, [vaultSearchOpen]);

  const onManualSyncRef = useRef(onManualSync);
  const manualSyncDisabledRef = useRef(manualSyncDisabled);
  const manualSyncRunningRef = useRef(manualSyncRunning);
  // Hold a stable ref to the gitStatusRef pointer so we avoid listing it as an effect dep.
  const gitStatusRefHolderRef = useRef(gitStatusRef);
  useLayoutEffect(() => {
    onManualSyncRef.current = onManualSync;
    manualSyncDisabledRef.current = manualSyncDisabled;
    manualSyncRunningRef.current = manualSyncRunning;
    gitStatusRefHolderRef.current = gitStatusRef;
  }, [onManualSync, manualSyncDisabled, manualSyncRunning, gitStatusRef]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!vaultRoot) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) {
        return;
      }
      if (e.key !== 's' && e.key !== 'S') {
        return;
      }
      if (
        manualSyncDisabledRef.current ||
        manualSyncRunningRef.current ||
        !onManualSyncRef.current
      ) {
        return;
      }
      // Preflight: skip sync silently if status says nothing to do.
      // Only applies when a gitStatusRef is wired up; absent ref means "no preflight" (legacy callers).
      const currentGitStatusRef = gitStatusRefHolderRef.current;
      if (currentGitStatusRef != null && !shouldRunVaultGitSync(currentGitStatusRef.current, 'keyboard')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onManualSyncRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [vaultRoot]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!vaultRoot) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey || e.altKey) {
        return;
      }
      if (e.key !== 't' && e.key !== 'T') {
        return;
      }
      if (busy || !canReopenClosedEditorTabRef.current) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      reopenLastClosedEditorTabRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [vaultRoot, busy]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!vaultRoot || busy) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) {
        return;
      }
      if (e.key !== 'e' && e.key !== 'E') {
        return;
      }
      const focusEl =
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null) ?? (e.target as HTMLElement | null);
      const inInboxCm = focusEl?.closest('.inbox-root .cm-editor');
      const inTodayHubCm = focusEl?.closest('.today-hub-canvas .cm-editor');
      if (!inInboxCm && !inTodayHubCm) {
        return;
      }
      if (composingNewEntry || !selectedUri) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCleanNoteInboxRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [vaultRoot, busy, composingNewEntry, selectedUri]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!vaultRoot || busy) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey || e.altKey) {
        return;
      }
      if (e.key !== 'f' && e.key !== 'F') {
        return;
      }
      if (quickOpenOpenRef.current || vaultSearchOpenRef.current) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setVaultSearchOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [vaultRoot, busy, setVaultSearchOpen]);

  useEffect(() => {
    let state = initialDoubleShiftState;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!vaultRoot || quickOpenOpenRef.current || vaultSearchOpenRef.current || busy) {
        return;
      }
      state = reduceDoubleShiftKeyDown(state, e.key, e.ctrlKey, e.metaKey, e.altKey);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!vaultRoot || quickOpenOpenRef.current || vaultSearchOpenRef.current || busy) {
        return;
      }
      if (e.repeat) {
        return;
      }
      const next = reduceDoubleShiftKeyUp(
        state,
        performance.now(),
        e.key,
        e.ctrlKey,
        e.metaKey,
        e.altKey,
      );
      state = next.state;
      if (next.shouldOpen) {
        e.preventDefault();
        e.stopPropagation();
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [vaultRoot, busy, setQuickOpenOpen]);
}
