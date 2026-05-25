import {useEffect} from 'react';

import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';

import {readLiveInboxFullMarkdownFromRefs} from './readLiveInboxFullMarkdown';
import {shouldScheduleInboxAutosave} from './shouldScheduleInboxAutosave';
import type {WorkspacePersistenceDeps} from './workspacePersistenceTypes';

export function useInboxAutosaveEffect(
  deps: WorkspacePersistenceDeps,
  enqueueInboxPersist: () => Promise<void>,
  autosaveSchedulerRef: {current: {schedule: (fn: () => void) => void; cancel: () => void}},
): void {
  const {refs, state} = deps;
  const {
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    diskConflict,
  } = state;

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
    if (refs.lastPersistedRef.current?.uri !== selectedUri) {
      autosaveSchedulerRef.current.cancel();
      return;
    }
    const liveFull = readLiveInboxFullMarkdownFromRefs(
      refs,
      editorBody,
      selectedUri,
      composingNewEntry,
    );
    if (
      !shouldScheduleInboxAutosave({
        vaultRoot,
        selectedUri,
        composingNewEntry,
        diskConflict,
        lastPersisted: refs.lastPersistedRef.current,
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
    // Individual refs match legacy deps; `refs` object is unstable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    vaultRoot,
    selectedUri,
    composingNewEntry,
    editorBody,
    state.inboxYamlFrontmatterInner,
    enqueueInboxPersist,
    diskConflict,
    refs.inboxYamlFrontmatterInnerRef,
    refs.inboxEditorYamlLeadingBeforeFrontmatterRef,
    refs.openTimeDiskBodyRef,
    refs.lastPersistedRef,
    autosaveSchedulerRef,
  ]);
}
