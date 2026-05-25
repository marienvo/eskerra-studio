import {normalizeEditorDocUri} from '../../lib/editorDocumentHistory';

import type {DiskConflictState, LastPersisted} from '../workspaceFsWatchReconcile';

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
