import type {EditorDocumentHistoryState} from '../../editorDocumentHistory';
import {
  normalizeEditorDocUri,
  remapEditorHistoryPrefix,
  remapVaultUriPrefix,
  removeEditorHistoryUris,
} from '../../editorDocumentHistory';
import type {HistoryStack, WorkspaceModel, WorkspaceState} from '../types';
import {createDefaultWorkspaceState, normalizeWorkspaceUri} from '../types';

function stackToEditor(h: HistoryStack): EditorDocumentHistoryState {
  return {entries: [...h.entries], index: h.index};
}

function editorToStack(e: EditorDocumentHistoryState): HistoryStack {
  if (e.entries.length === 0) {
    return {entries: [], index: 0};
  }
  let idx = e.index;
  if (idx < 0 || idx >= e.entries.length) {
    idx = e.entries.length - 1;
  }
  return {entries: e.entries, index: idx};
}

function pruneWorkspaceState(
  hubKey: string,
  ws: WorkspaceState,
  shouldRemove: (u: string) => boolean,
): WorkspaceState | null {
  if (shouldRemove(normalizeWorkspaceUri(hubKey))) {
    return null;
  }
  const homeAfter = removeEditorHistoryUris(stackToEditor(ws.homeHistory), shouldRemove);
  const home = editorToStack(homeAfter);
  if (
    home.entries.length === 0 ||
    normalizeWorkspaceUri(home.entries[0]!) !== normalizeWorkspaceUri(hubKey)
  ) {
    return createDefaultWorkspaceState(hubKey);
  }
  const nextTabs = ws.tabs
    .map(t => ({
      ...t,
      history: editorToStack(removeEditorHistoryUris(stackToEditor(t.history), shouldRemove)),
    }))
    .filter(t => t.history.entries.length > 0);
  let nextActive = ws.active;
  const curActive = ws.active;
  if (curActive.kind === 'tab') {
    if (!nextTabs.some(t => t.id === curActive.id)) {
      nextActive = {kind: 'home'};
    }
  }
  return {...ws, homeHistory: home, tabs: nextTabs, active: nextActive};
}

function remapWorkspaceState(
  hubKey: string,
  ws: WorkspaceState,
  oldPrefix: string,
  newPrefix: string,
): WorkspaceState {
  const mappedHub =
    normalizeWorkspaceUri(remapVaultUriPrefix(hubKey, oldPrefix, newPrefix) ?? hubKey);
  const home = editorToStack(
    remapEditorHistoryPrefix(stackToEditor(ws.homeHistory), oldPrefix, newPrefix),
  );
  const fixedHome =
    home.entries.length > 0 &&
    normalizeEditorDocUri(home.entries[0]!) === normalizeEditorDocUri(mappedHub)
      ? home
      : {entries: [mappedHub], index: 0};
  const tabs = ws.tabs.map(t => ({
    ...t,
    history: editorToStack(remapEditorHistoryPrefix(stackToEditor(t.history), oldPrefix, newPrefix)),
  }));
  return {...ws, homeHistory: fixedHome, tabs};
}

/**
 * If two hub keys remap to the same URI, the later iteration wins in `Object.assign` sense
 * (last write wins over the shared record key) — assumed rare; rename one hub at a time.
 */
export function remapPrefixAction(
  m: WorkspaceModel,
  oldPrefix: string,
  newPrefix: string,
): WorkspaceModel {
  const nextWorkspaces: Record<string, WorkspaceState> = {};
  for (const [hubKey, ws] of Object.entries(m.workspaces)) {
    const mappedKey = normalizeWorkspaceUri(
      remapVaultUriPrefix(hubKey, oldPrefix, newPrefix) ?? hubKey,
    );
    nextWorkspaces[mappedKey] = remapWorkspaceState(hubKey, ws, oldPrefix, newPrefix);
  }
  let activeHub = m.activeHub;
  if (activeHub != null) {
    activeHub = normalizeWorkspaceUri(
      remapVaultUriPrefix(activeHub, oldPrefix, newPrefix) ?? activeHub,
    );
  }
  return {...m, workspaces: nextWorkspaces, activeHub};
}

/**
 * Drops workspaces whose hub URI matches the predicate; prunes matching URIs from histories.
 * When the active hub is removed, activeHub becomes the first key in lexicographic order, or null.
 */
export function removeUrisAction(
  m: WorkspaceModel,
  predicate: (normalizedUri: string) => boolean,
): WorkspaceModel {
  const nextWorkspaces: Record<string, WorkspaceState> = {};
  for (const [hubKey, ws] of Object.entries(m.workspaces)) {
    const pruned = pruneWorkspaceState(hubKey, ws, predicate);
    if (pruned != null) {
      nextWorkspaces[hubKey] = pruned;
    }
  }
  const keys = Object.keys(nextWorkspaces).sort();
  let activeHub = m.activeHub;
  if (keys.length === 0) {
    return {workspaces: nextWorkspaces, activeHub: null};
  }
  if (activeHub != null) {
    const ah = normalizeWorkspaceUri(activeHub);
    if (!nextWorkspaces[ah]) {
      activeHub = keys[0]!;
    }
  }
  return {workspaces: nextWorkspaces, activeHub};
}
