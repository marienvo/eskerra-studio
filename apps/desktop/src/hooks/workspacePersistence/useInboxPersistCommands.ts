import {useCallback, useLayoutEffect, useRef, type MutableRefObject} from 'react';

import {
  createInboxAutosaveScheduler,
  INBOX_AUTOSAVE_DEBOUNCE_MS,
} from '../../lib/inboxAutosaveScheduler';
import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';
import {reportCrash} from '../../observability/reportCrash';

import {enqueueOnSaveChain} from './enqueueOnSaveChain';
import {INBOX_DISK_CONFLICT_FLUSH_ERROR} from './inboxPersistErrors';
import {mergeInboxNoteBodyCacheRefAndState} from './mergeInboxNoteBodyCache';
import {persistActiveInboxNote} from './persistActiveInboxNote';
import {persistOutgoingNoteSnapshot} from './persistOutgoingNoteSnapshot';
import type {WorkspacePersistenceDeps} from './workspacePersistenceTypes';

export function useInboxPersistCommands(deps: WorkspacePersistenceDeps): {
  saveChainRef: MutableRefObject<Promise<void>>;
  saveActiveRef: MutableRefObject<boolean>;
  autosaveSchedulerRef: MutableRefObject<ReturnType<typeof createInboxAutosaveScheduler>>;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  mergeInboxNoteBodyCacheRefAndState: (norm: string, body: string) => void;
  enqueuePersistOutgoingNoteMarkdown: (uri: string, leaveSnapshotMarkdown: string) => void;
  enqueueInboxPersist: () => Promise<void>;
  flushInboxSave: () => Promise<void>;
  onInboxSaveShortcut: () => void;
} {
  const depsRef = useRef(deps);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveActiveRef = useRef(false);
  const autosaveSchedulerRef = useRef(
    createInboxAutosaveScheduler(INBOX_AUTOSAVE_DEBOUNCE_MS),
  );
  const flushInboxSaveRef = useRef<() => Promise<void>>(async () => {});

  useLayoutEffect(() => {
    depsRef.current = deps;
  });

  const mergeCache = useCallback((norm: string, body: string) => {
    const {refs, actions} = depsRef.current;
    mergeInboxNoteBodyCacheRefAndState(
      refs.inboxContentByUriRef,
      actions.setInboxContentByUri,
      norm,
      body,
    );
  }, []);

  const enqueuePersistOutgoingNoteMarkdown = useCallback(
    (uri: string, leaveSnapshotMarkdown: string): void => {
      const norm = normalizeEditorDocUri(uri);
      const {fs, refs, actions} = depsRef.current;
      void enqueueOnSaveChain({
        saveChainRef,
        saveActiveRef,
        run: async () => {
          try {
            await persistOutgoingNoteSnapshot({
              fs,
              refs,
              actions,
              norm,
              leaveSnapshotMarkdown,
            });
          } catch (e) {
            actions.setErr(e instanceof Error ? e.message : String(e));
          }
        },
      });
    },
    [],
  );

  const enqueueInboxPersist = useCallback(async (): Promise<void> => {
    const {fs, refs, actions} = depsRef.current;
    await enqueueOnSaveChain({
      saveChainRef,
      saveActiveRef,
      awaitResult: true,
      run: async () => {
        try {
          await persistActiveInboxNote({fs, refs, actions});
        } catch (e) {
          actions.setErr(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }, []);

  const flushInboxSave = useCallback(async () => {
    const {refs, actions} = depsRef.current;
    autosaveSchedulerRef.current.cancel();
    await refs.todayHubBridgeRef.current.flushPendingEdits().catch(() => undefined);
    const uri = refs.selectedUriRef.current;
    const dc = refs.diskConflictRef.current;
    if (
      dc &&
      uri &&
      normalizeEditorDocUri(dc.uri) === normalizeEditorDocUri(uri)
    ) {
      actions.setErr(INBOX_DISK_CONFLICT_FLUSH_ERROR);
      return;
    }
    await enqueueInboxPersist();
  }, [enqueueInboxPersist]);

  useLayoutEffect(() => {
    flushInboxSaveRef.current = flushInboxSave;
  }, [flushInboxSave]);

  const onInboxSaveShortcut = useCallback(() => {
    const {refs} = depsRef.current;
    const save = refs.composingNewEntryRef.current
      ? refs.submitNewEntryRef.current()
      : flushInboxSave();
    save.catch(e => reportCrash('unhandledrejection', e));
  }, [flushInboxSave]);

  return {
    saveChainRef,
    saveActiveRef,
    autosaveSchedulerRef,
    flushInboxSaveRef,
    mergeInboxNoteBodyCacheRefAndState: mergeCache,
    enqueuePersistOutgoingNoteMarkdown,
    enqueueInboxPersist,
    flushInboxSave,
    onInboxSaveShortcut,
  };
}
