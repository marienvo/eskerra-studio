import type {HistoryStack, WorkspaceModel, WorkspaceState} from './types';

export function activeWorkspaceState(m: WorkspaceModel): WorkspaceState | null {
  if (m.activeHub == null) {
    return null;
  }
  return m.workspaces[m.activeHub] ?? null;
}

function currentUriFromStack(stack: HistoryStack): string | null {
  const {entries, index} = stack;
  if (entries.length === 0 || index < 0 || index >= entries.length) {
    return null;
  }
  return entries[index] ?? null;
}

/** Current URI for the focused surface (Home current page or tab's current doc). */
export function activeSurfaceUri(m: WorkspaceModel): string | null {
  const ws = activeWorkspaceState(m);
  if (!ws) {
    return null;
  }
  const surface = ws.active;
  if (surface.kind === 'tab') {
    const tab = ws.tabs.find(t => t.id === surface.id);
    if (!tab) {
      return null;
    }
    return currentUriFromStack(tab.history);
  }
  return currentUriFromStack(ws.homeHistory);
}

/** Home stack's current URI (independent of whether Home is the active surface). */
export function homeCurrentUri(m: WorkspaceModel): string | null {
  const ws = activeWorkspaceState(m);
  if (!ws) {
    return null;
  }
  return currentUriFromStack(ws.homeHistory);
}

export function activeTabHistory(m: WorkspaceModel): HistoryStack | null {
  const ws = activeWorkspaceState(m);
  if (!ws || ws.active.kind !== 'tab') {
    return null;
  }
  const activeTab = ws.active;
  const tab = ws.tabs.find(t => t.id === activeTab.id);
  return tab?.history ?? null;
}

/**
 * Sub-label for the workspace selector when Home has navigated away from Today (index > 0).
 * Returns the current Home URI; UI may map this to a display title (e.g. noteTitleFromUri).
 */
export function workspaceSelectorSubLabel(m: WorkspaceModel): string | null {
  const ws = activeWorkspaceState(m);
  if (!ws) {
    return null;
  }
  if (ws.homeHistory.entries.length === 0) {
    return null;
  }
  if (ws.homeHistory.index <= 0) {
    return null;
  }
  return currentUriFromStack(ws.homeHistory);
}

/** Pill styling is tied to Home being the focused surface, not Home history depth. */
export function workspaceSelectorShowsActiveTabPill(m: WorkspaceModel): boolean {
  const ws = activeWorkspaceState(m);
  if (!ws) {
    return false;
  }
  return ws.active.kind === 'home';
}

function canGoBackOnStack(stack: HistoryStack): boolean {
  return stack.entries.length > 0 && stack.index > 0;
}

function canGoForwardOnStack(stack: HistoryStack): boolean {
  return stack.entries.length > 0 && stack.index < stack.entries.length - 1;
}

export function canGoBack(m: WorkspaceModel): boolean {
  const ws = activeWorkspaceState(m);
  if (!ws) {
    return false;
  }
  const surface = ws.active;
  if (surface.kind === 'home') {
    return canGoBackOnStack(ws.homeHistory);
  }
  if (surface.kind === 'tab') {
    const tab = ws.tabs.find(t => t.id === surface.id);
    if (!tab) {
      return false;
    }
    return canGoBackOnStack(tab.history);
  }
  return false;
}

export function canGoForward(m: WorkspaceModel): boolean {
  const ws = activeWorkspaceState(m);
  if (!ws) {
    return false;
  }
  const surface = ws.active;
  if (surface.kind === 'home') {
    return canGoForwardOnStack(ws.homeHistory);
  }
  if (surface.kind === 'tab') {
    const tab = ws.tabs.find(t => t.id === surface.id);
    if (!tab) {
      return false;
    }
    return canGoForwardOnStack(tab.history);
  }
  return false;
}
