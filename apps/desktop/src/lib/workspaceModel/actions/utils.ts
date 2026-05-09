import type {EditorDocumentHistoryState} from '../../editorDocumentHistory';
import type {HistoryStack, WorkspaceModel, WorkspaceState} from '../types';

export function patchActiveWorkspace(
  m: WorkspaceModel,
  patch: (ws: WorkspaceState) => WorkspaceState,
): WorkspaceModel {
  if (m.activeHub == null) {
    return m;
  }
  const cur = m.workspaces[m.activeHub];
  if (!cur) {
    return m;
  }
  return {
    ...m,
    workspaces: {
      ...m.workspaces,
      [m.activeHub]: patch(cur),
    },
  };
}

export function stackToEditor(h: HistoryStack): EditorDocumentHistoryState {
  return {entries: [...h.entries], index: h.index};
}

export function editorToStack(e: EditorDocumentHistoryState): HistoryStack {
  if (e.entries.length === 0) {
    return {entries: [], index: 0};
  }
  let idx = e.index;
  if (idx < 0 || idx >= e.entries.length) {
    idx = e.entries.length - 1;
  }
  return {entries: e.entries, index: idx};
}
