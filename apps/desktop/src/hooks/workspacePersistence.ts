import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  markdownContainsTransientImageUrls,
  type VaultFilesystem,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {
  createInboxAutosaveScheduler,
  INBOX_AUTOSAVE_DEBOUNCE_MS,
} from '../lib/inboxAutosaveScheduler';
import {persistTransientMarkdownImages} from '../lib/persistTransientMarkdownImages';
import {saveNoteMarkdown} from '../lib/vaultBootstrap';
import type {TodayHubWorkspaceBridge} from '../lib/todayHub';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {reportCrash} from '../observability/reportCrash';

import type {
  DiskConflictState,
  LastPersisted,
} from './workspaceFsWatchReconcile';
import {
  mergeInboxNoteBodyIntoCache,
  shouldMergeCacheAfterOutgoingPersist,
  shouldSkipOutgoingPersistAfterNoteLeave,
  shouldSkipOutgoingPersistBeforeWrite,
} from './inboxNoteBodyCache';
import {persistableInboxEditorFullMarkdown} from './openNotePersistence';

export function shouldScheduleInboxAutosave(args: {
  vaultRoot: string | null;
  selectedUri: string | null;
  composingNewEntry: boolean;
  diskConflict: DiskConflictState | null;
  lastPersisted: LastPersisted | null;
  liveFullMarkdown: string;
}): boolean {
  const {
    vaultRoot,
    selectedUri,
    composingNewEntry,
    diskConflict,
    lastPersisted,
    liveFullMarkdown,
  } = args;
  if (!vaultRoot || !selectedUri || composingNewEntry) {
    return false;
  }
  if (
    diskConflict &&
    normalizeEditorDocUri(diskConflict.uri) === normalizeEditorDocUri(selectedUri)
  ) {
    return false;
  }
  if (lastPersisted?.uri !== selectedUri) {
    return false;
  }
  return lastPersisted.markdown !== liveFullMarkdown;
}

export function useWorkspacePersistence(args: {
  fs: VaultFilesystem;
  vaultRoot: string | null;
  selectedUri: string | null;
  composingNewEntry: boolean;
  editorBody: string;
  inboxYamlFrontmatterInner: string | null;
  diskConflict: DiskConflictState | null;
  vaultRootRef: MutableRefObject<string | null>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  editorBodyRef: MutableRefObject<string>;
  openTimeDiskBodyRef: MutableRefObject<string>;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  setLastPersistedSnapshot: (next: LastPersisted) => void;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  submitNewEntryRef: MutableRefObject<() => Promise<unknown>>;
  setErr: (value: string | null) => void;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  refreshNotes: (root: string) => Promise<void>;
  onVaultWriteSettled: () => void;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string,
    selection: 'preserve' | 'start',
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
}): {
  saveChainRef: MutableRefObject<Promise<void>>;
  saveActiveRef: MutableRefObject<boolean>;
  autosaveSchedulerRef: MutableRefObject<ReturnType<typeof createInboxAutosaveScheduler>>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  mergeInboxNoteBodyCacheRefAndState: (norm: string, body: string) => void;
  enqueuePersistOutgoingNoteMarkdown: (
    uri: string,
    leaveSnapshotMarkdown: string,
  ) => void;
  enqueueInboxPersist: () => Promise<void>;
  flushInboxSave: () => Promise<void>;
  onInboxSaveShortcut: () => void;
} {
  const {
    fs,
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    diskConflict,
    vaultRootRef,
    selectedUriRef,
    composingNewEntryRef,
    diskConflictRef,
    inboxContentByUriRef,
    editorBodyRef,
    openTimeDiskBodyRef,
    lastPersistedRef,
    setLastPersistedSnapshot,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxEditorRef,
    todayHubBridgeRef,
    submitNewEntryRef,
    setErr,
    setInboxContentByUri,
    refreshNotes,
    onVaultWriteSettled,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
  } = args;
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveActiveRef = useRef(false);
  const autosaveSchedulerRef = useRef(
    createInboxAutosaveScheduler(INBOX_AUTOSAVE_DEBOUNCE_MS),
  );
  const flushInboxSaveRef = useRef<() => Promise<void>>(async () => {});

  /** Merge a known-good body for `norm` into the inbox content cache (state + ref). No-op if no change. */
  const mergeInboxNoteBodyCacheRefAndState = useCallback(
    (norm: string, body: string) => {
      const nextCache = mergeInboxNoteBodyIntoCache(
        inboxContentByUriRef.current,
        norm,
        body,
      );
      if (!nextCache) {
        return;
      }
      inboxContentByUriRef.current = nextCache;
      setInboxContentByUri(prev =>
        mergeInboxNoteBodyIntoCache(prev, norm, body) ?? prev,
      );
    },
    [inboxContentByUriRef, setInboxContentByUri],
  );

  /**
   * Persists a fixed URI + markdown captured when leaving a dirty note, chained like
   * `enqueueInboxPersist` but **not** awaited by open-note routing.
   */
  const enqueuePersistOutgoingNoteMarkdown = useCallback(
    (uri: string, leaveSnapshotMarkdown: string): void => {
      const norm = normalizeEditorDocUri(uri);

      const persistOutgoingNoteSnapshot = async (): Promise<void> => {
        const root = vaultRootRef.current;
        if (!root) return;
        const dc = diskConflictRef.current;
        if (dc && normalizeEditorDocUri(dc.uri) === norm) return;
        const memStart = inboxContentByUriRef.current[norm];
        if (shouldSkipOutgoingPersistAfterNoteLeave(memStart, leaveSnapshotMarkdown)) return;

        setErr(null);
        const md = await persistTransientMarkdownImages(leaveSnapshotMarkdown, root);
        if (markdownContainsTransientImageUrls(md)) {
          setErr(
            'Cannot save: some images are still temporary (blob or data URLs). Paste images again so they are stored under Assets/Attachments, or remove those image references.',
          );
          return;
        }
        if (md !== leaveSnapshotMarkdown) {
          mergeInboxNoteBodyCacheRefAndState(norm, md);
          const active = selectedUriRef.current;
          if (active && normalizeEditorDocUri(active) === norm) {
            loadFullMarkdownIntoInboxEditor(md, norm, 'preserve');
            scheduleBacklinksDeferOneFrameAfterLoad();
          }
        }
        const memBeforeSave = inboxContentByUriRef.current[norm];
        if (shouldSkipOutgoingPersistBeforeWrite(memBeforeSave, leaveSnapshotMarkdown, md)) {
          return;
        }
        await saveNoteMarkdown(norm, fs, md);
        onVaultWriteSettled();
        refreshNotes(root).catch(() => undefined);

        const activeSel = selectedUriRef.current;
        if (activeSel && normalizeEditorDocUri(activeSel) === norm) {
          setLastPersistedSnapshot({uri: norm, markdown: md});
        }
        const memAfter = inboxContentByUriRef.current[norm];
        if (shouldMergeCacheAfterOutgoingPersist(memAfter, md, leaveSnapshotMarkdown)) {
          mergeInboxNoteBodyCacheRefAndState(norm, md);
        }
      };

      const run = async (): Promise<void> => {
        try {
          await persistOutgoingNoteSnapshot();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      };

      saveActiveRef.current = true;
      const next = saveChainRef.current.then(run).finally(() => {
        saveActiveRef.current = false;
      });
      saveChainRef.current = next.catch(() => undefined);
    },
    [
      fs,
      refreshNotes,
      loadFullMarkdownIntoInboxEditor,
      scheduleBacklinksDeferOneFrameAfterLoad,
      mergeInboxNoteBodyCacheRefAndState,
      vaultRootRef,
      diskConflictRef,
      inboxContentByUriRef,
      selectedUriRef,
      setErr,
      onVaultWriteSettled,
      setLastPersistedSnapshot,
    ],
  );

  const enqueueInboxPersist = useCallback(async (): Promise<void> => {
    const run = async (): Promise<void> => {
      const root = vaultRootRef.current;
      const uri = selectedUriRef.current;
      if (!root || !uri || composingNewEntryRef.current) {
        return;
      }
      const dc = diskConflictRef.current;
      if (dc && normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(uri)) {
        return;
      }
      const prev = lastPersistedRef.current;
      const raw = persistableInboxEditorFullMarkdown({
        editorBodySlice:
          inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current,
        diskBodyBaseline: openTimeDiskBodyRef.current || null,
        selectedUri: selectedUriRef.current,
        composingNewEntry: composingNewEntryRef.current,
        yamlInner: inboxYamlFrontmatterInnerRef.current,
        yamlLeading: inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      });
      if (prev && prev.uri === uri && prev.markdown === raw) {
        return;
      }
      try {
        setErr(null);
        const md = await persistTransientMarkdownImages(raw, root);
        if (markdownContainsTransientImageUrls(md)) {
          setErr(
            'Cannot save: some images are still temporary (blob or data URLs). Paste images again so they are stored under Assets/Attachments, or remove those image references.',
          );
          return;
        }
        if (md !== raw) {
          loadFullMarkdownIntoInboxEditor(md, uri, 'preserve');
          scheduleBacklinksDeferOneFrameAfterLoad();
        }
        await saveNoteMarkdown(uri, fs, md);
        onVaultWriteSettled();
        await refreshNotes(root);
        if (selectedUriRef.current !== uri || composingNewEntryRef.current) {
          return;
        }
        setLastPersistedSnapshot({uri, markdown: md});
        const nextCache = mergeInboxNoteBodyIntoCache(
          inboxContentByUriRef.current,
          uri,
          md,
        );
        if (nextCache) {
          inboxContentByUriRef.current = nextCache;
          setInboxContentByUri(prev =>
            mergeInboxNoteBodyIntoCache(prev, uri, md) ?? prev,
          );
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    };

    saveActiveRef.current = true;
    const next = saveChainRef.current.then(run).finally(() => {
      saveActiveRef.current = false;
    });
    saveChainRef.current = next.catch(() => undefined);
    await next;
  }, [
    fs,
    refreshNotes,
    inboxEditorRef,
    scheduleBacklinksDeferOneFrameAfterLoad,
    loadFullMarkdownIntoInboxEditor,
    vaultRootRef,
    selectedUriRef,
    composingNewEntryRef,
    diskConflictRef,
    editorBodyRef,
    openTimeDiskBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    lastPersistedRef,
    inboxContentByUriRef,
    setErr,
    setInboxContentByUri,
    onVaultWriteSettled,
    setLastPersistedSnapshot,
  ]);

  const flushInboxSave = useCallback(async () => {
    autosaveSchedulerRef.current.cancel();
    await todayHubBridgeRef.current.flushPendingEdits().catch(() => undefined);
    const uri = selectedUriRef.current;
    const dc = diskConflictRef.current;
    if (
      dc &&
      uri &&
      normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(uri)
    ) {
      setErr(
        'This note changed on disk while you were editing. Choose Reload from disk or Keep my edits before saving.',
      );
      return;
    }
    await enqueueInboxPersist();
  }, [enqueueInboxPersist, todayHubBridgeRef, selectedUriRef, diskConflictRef, setErr]);

  useLayoutEffect(() => {
    flushInboxSaveRef.current = flushInboxSave;
  }, [flushInboxSave]);

  const onInboxSaveShortcut = useCallback(() => {
    const save = composingNewEntryRef.current
      ? submitNewEntryRef.current()
      : flushInboxSave();
    save.catch(e => reportCrash('unhandledrejection', e));
  }, [composingNewEntryRef, submitNewEntryRef, flushInboxSave]);

  useEffect(() => {
    if (!vaultRoot || !selectedUri || composingNewEntry) {
      autosaveSchedulerRef.current.cancel();
      return;
    }
    if (
      diskConflict &&
      normalizeEditorDocUri(diskConflict.uri) === normalizeEditorDocUri(selectedUri)
    ) {
      autosaveSchedulerRef.current.cancel();
      return;
    }
    if (lastPersistedRef.current?.uri !== selectedUri) {
      autosaveSchedulerRef.current.cancel();
      return;
    }
    const liveFull = persistableInboxEditorFullMarkdown({
      editorBodySlice: editorBody,
      diskBodyBaseline: openTimeDiskBodyRef.current || null,
      selectedUri,
      composingNewEntry,
      yamlInner: inboxYamlFrontmatterInnerRef.current,
      yamlLeading: inboxEditorYamlLeadingBeforeFrontmatterRef.current,
    });
    if (
      !shouldScheduleInboxAutosave({
        vaultRoot,
        selectedUri,
        composingNewEntry,
        diskConflict,
        lastPersisted: lastPersistedRef.current,
        liveFullMarkdown: liveFull,
      })
    ) {
      return;
    }
    const scheduler = autosaveSchedulerRef.current;
    scheduler.schedule(() => {
      void enqueueInboxPersist();
    });
    return () => {
      scheduler.cancel();
    };
  }, [
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    enqueueInboxPersist,
    diskConflict,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    openTimeDiskBodyRef,
    lastPersistedRef,
  ]);

  return {
    saveChainRef,
    saveActiveRef,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    mergeInboxNoteBodyCacheRefAndState,
    enqueuePersistOutgoingNoteMarkdown,
    enqueueInboxPersist,
    flushInboxSave,
    onInboxSaveShortcut,
  };
}
