import type {EditorDocumentHistoryState} from './editorDocumentHistory';
import {
  normalizeEditorDocUri,
  pushEditorHistoryEntry,
  remapEditorHistoryPrefix,
  removeEditorHistoryUris,
} from './editorDocumentHistory';

export type WorkspaceHomeState = {
  history: EditorDocumentHistoryState;
};

export function createWorkspaceHomeState(
  activeTodayHubUri: string,
): WorkspaceHomeState {
  const hub = normalizeEditorDocUri(activeTodayHubUri);
  return {history: hub ? {entries: [hub], index: 0} : {entries: [], index: -1}};
}

export function pushHomeNavigate(
  state: WorkspaceHomeState,
  uri: string,
): WorkspaceHomeState {
  return {...state, history: pushEditorHistoryEntry(state.history, uri)};
}

export function homeCurrentUri(state: WorkspaceHomeState): string | null {
  const {entries, index} = state.history;
  if (index < 0 || index >= entries.length) {
    return null;
  }
  return entries[index] ?? null;
}

/** Hub root Today.md (`history.entries[0]`), not the home history cursor. */
export function homeHubUri(state: WorkspaceHomeState): string | null {
  return state.history.entries[0] ?? null;
}

export function homeIsAtHub(state: WorkspaceHomeState): boolean {
  return state.history.index === 0;
}

export function homeCanGoBack(state: WorkspaceHomeState): boolean {
  return state.history.index > 0;
}

export function homeCanGoForward(state: WorkspaceHomeState): boolean {
  return state.history.index >= 0 && state.history.index < state.history.entries.length - 1;
}

export function homeGoBack(state: WorkspaceHomeState): WorkspaceHomeState {
  if (!homeCanGoBack(state)) {
    return state;
  }
  return {
    ...state,
    history: {...state.history, index: state.history.index - 1},
  };
}

export function homeGoForward(state: WorkspaceHomeState): WorkspaceHomeState {
  if (!homeCanGoForward(state)) {
    return state;
  }
  return {
    ...state,
    history: {...state.history, index: state.history.index + 1},
  };
}

export function homeRemapPrefix(
  state: WorkspaceHomeState,
  oldPrefix: string,
  newPrefix: string,
): WorkspaceHomeState {
  return {
    ...state,
    history: remapEditorHistoryPrefix(state.history, oldPrefix, newPrefix),
  };
}

export function homeRemoveUris(
  state: WorkspaceHomeState,
  shouldRemove: (normalizedUri: string) => boolean,
): WorkspaceHomeState | null {
  const hub = state.history.entries[0];
  if (hub == null || shouldRemove(normalizeEditorDocUri(hub))) {
    return null;
  }
  return {
    ...state,
    history: removeEditorHistoryUris(state.history, shouldRemove),
  };
}
