import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {mergeInboxNoteBodyIntoCache} from './inboxNoteBodyCache';
import type {
  DiskConflictSoftState,
  DiskConflictState,
  LastPersisted,
} from './workspaceFsWatchReconcile';

type UseDiskConflictStateOptions = {
  loadFullMarkdownIntoInboxEditor: (
    full: string,
    uri: string,
    selection: 'start' | 'preserve',
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  cancelAutosave: () => void;
  selectedUriRef: MutableRefObject<string | null>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  skipRecencyDeferForUriRef: MutableRefObject<Set<string>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setErr: Dispatch<SetStateAction<string | null>>;
};

export type UseDiskConflictStateResult = {
  diskConflict: DiskConflictState | null;
  setDiskConflict: Dispatch<SetStateAction<DiskConflictState | null>>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  diskConflictSoft: DiskConflictSoftState | null;
  setDiskConflictSoft: Dispatch<SetStateAction<DiskConflictSoftState | null>>;
  diskConflictSoftRef: MutableRefObject<DiskConflictSoftState | null>;
  diskConflictDeferTimerRef: MutableRefObject<number | null>;
  clearDiskConflictUiForHydrate: () => void;
  resolveDiskConflictReloadFromDisk: () => void;
  resolveDiskConflictKeepLocal: () => void;
  elevateDiskConflictSoftToBlocking: () => void;
  /** Clears blocking + soft conflict UI after recording disk markdown as last persisted (merge-apply path). */
  clearBlockingDiskConflictForMergedBody: () => void;
  dismissDiskConflictSoft: () => void;
  clearStaleDiskConflictsForOpen: (targetNorm: string) => void;
};

export function useDiskConflictState(
  options: UseDiskConflictStateOptions,
): UseDiskConflictStateResult {
  const {
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    cancelAutosave,
    selectedUriRef,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
    inboxContentByUriRef,
    skipRecencyDeferForUriRef,
    setInboxContentByUri,
    setErr,
  } = options;

  const [diskConflict, setDiskConflict] = useState<DiskConflictState | null>(null);
  const diskConflictRef = useRef<DiskConflictState | null>(null);
  const [diskConflictSoft, setDiskConflictSoft] = useState<DiskConflictSoftState | null>(null);
  const diskConflictSoftRef = useRef<DiskConflictSoftState | null>(null);
  const diskConflictDeferTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    diskConflictRef.current = diskConflict;
  }, [diskConflict]);

  useLayoutEffect(() => {
    diskConflictSoftRef.current = diskConflictSoft;
  }, [diskConflictSoft]);

  const clearDiskConflictUiForHydrate = useCallback(() => {
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
  }, []);

  const resolveDiskConflictReloadFromDisk = useCallback(() => {
    const c = diskConflictRef.current;
    const uri = selectedUriRef.current;
    if (!c || !uri || normalizeEditorDocUri(c.uri) !== normalizeEditorDocUri(uri)) {
      return;
    }
    const md = c.diskMarkdown;
    loadFullMarkdownIntoInboxEditor(md, uri, 'start');
    scheduleBacklinksDeferOneFrameAfterLoad();
    lastPersistedRef.current = {uri: c.uri, markdown: md};
    lastPersistedExternalMutationSeqRef.current += 1;
    const nextCache = mergeInboxNoteBodyIntoCache(
      inboxContentByUriRef.current,
      c.uri,
      md,
    );
    if (nextCache) {
      inboxContentByUriRef.current = nextCache;
      setInboxContentByUri(prev =>
        mergeInboxNoteBodyIntoCache(prev, c.uri, md) ?? prev,
      );
    }
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    setErr(null);
  }, [
    inboxContentByUriRef,
    lastPersistedExternalMutationSeqRef,
    lastPersistedRef,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    selectedUriRef,
    setErr,
    setInboxContentByUri,
  ]);

  const resolveDiskConflictKeepLocal = useCallback(() => {
    const c = diskConflictRef.current;
    const uri = selectedUriRef.current;
    if (!c || !uri || normalizeEditorDocUri(c.uri) !== normalizeEditorDocUri(uri)) {
      return;
    }
    cancelAutosave();
    lastPersistedRef.current = {uri: c.uri, markdown: c.diskMarkdown};
    lastPersistedExternalMutationSeqRef.current += 1;
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    setErr(null);
  }, [
    cancelAutosave,
    lastPersistedExternalMutationSeqRef,
    lastPersistedRef,
    selectedUriRef,
    setErr,
  ]);

  const elevateDiskConflictSoftToBlocking = useCallback(() => {
    const s = diskConflictSoftRef.current;
    const uri = selectedUriRef.current;
    if (!s || !uri || normalizeEditorDocUri(s.uri) !== normalizeEditorDocUri(uri)) {
      return;
    }
    cancelAutosave();
    const hard: DiskConflictState = {uri: s.uri, diskMarkdown: s.diskMarkdown};
    setDiskConflict(hard);
    diskConflictRef.current = hard;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
  }, [cancelAutosave, selectedUriRef]);

  const clearBlockingDiskConflictForMergedBody = useCallback(() => {
    cancelAutosave();
    const c = diskConflictRef.current;
    if (c) {
      lastPersistedRef.current = {uri: c.uri, markdown: c.diskMarkdown};
      lastPersistedExternalMutationSeqRef.current += 1;
    }
    setDiskConflict(null);
    diskConflictRef.current = null;
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
  }, [cancelAutosave, lastPersistedExternalMutationSeqRef, lastPersistedRef]);

  const dismissDiskConflictSoft = useCallback(() => {
    setDiskConflictSoft(null);
    diskConflictSoftRef.current = null;
    skipRecencyDeferForUriRef.current.clear();
  }, [skipRecencyDeferForUriRef]);

  const clearStaleDiskConflictsForOpen = useCallback((targetNorm: string) => {
    const prevConflict = diskConflictRef.current;
    if (prevConflict && normalizeEditorDocUri(prevConflict.uri) !== targetNorm) {
      setDiskConflict(null);
      diskConflictRef.current = null;
    }
    const prevSoft = diskConflictSoftRef.current;
    if (prevSoft && normalizeEditorDocUri(prevSoft.uri) !== targetNorm) {
      setDiskConflictSoft(null);
      diskConflictSoftRef.current = null;
    }
  }, []);

  return {
    diskConflict,
    setDiskConflict,
    diskConflictRef,
    diskConflictSoft,
    setDiskConflictSoft,
    diskConflictSoftRef,
    diskConflictDeferTimerRef,
    clearDiskConflictUiForHydrate,
    resolveDiskConflictReloadFromDisk,
    resolveDiskConflictKeepLocal,
    elevateDiskConflictSoftToBlocking,
    clearBlockingDiskConflictForMergedBody,
    dismissDiskConflictSoft,
    clearStaleDiskConflictsForOpen,
  };
}
