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
  const {fs, refs, actions} = deps;
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveActiveRef = useRef(false);
  const autosaveSchedulerRef = useRef(
    createInboxAutosaveScheduler(INBOX_AUTOSAVE_DEBOUNCE_MS),
  );
  const flushInboxSaveRef = useRef<() => Promise<void>>(async () => {});

  const mergeCache = useCallback(
    (norm: string, body: string) => {
      mergeInboxNoteBodyCacheRefAndState(
        refs.inboxContentByUriRef,
        actions.setInboxContentByUri,
        norm,
        body,
      );
    },
    [refs.inboxContentByUriRef, actions.setInboxContentByUri],
  );

  const enqueuePersistOutgoingNoteMarkdown = useCallback(
    (uri: string, leaveSnapshotMarkdown: string): void => {
      const norm = normalizeEditorDocUri(uri);
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
    [fs, refs, actions],
  );

  const enqueueInboxPersist = useCallback(async (): Promise<void> => {
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
  }, [fs, refs, actions]);

  const flushInboxSave = useCallback(async () => {
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
  }, [enqueueInboxPersist, refs.todayHubBridgeRef, refs.selectedUriRef, refs.diskConflictRef, actions]);

  useLayoutEffect(() => {
    flushInboxSaveRef.current = flushInboxSave;
  }, [flushInboxSave]);

  const onInboxSaveShortcut = useCallback(() => {
    const save = refs.composingNewEntryRef.current
      ? refs.submitNewEntryRef.current()
      : flushInboxSave();
    save.catch(e => reportCrash('unhandledrejection', e));
  }, [refs.composingNewEntryRef, refs.submitNewEntryRef, flushInboxSave]);

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
