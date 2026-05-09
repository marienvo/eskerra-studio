/**
 * Pure workspace data: per-hub tabs, Home history, and active surface (Home vs tab).
 * URIs are normalized with trim + backslash-to-slash for stable map keys and comparisons.
 */

export type HistoryStack = {
  /** First entry is the stack root (hub Today URI for Home). */
  entries: ReadonlyArray<string>;
  /** Valid range: 0 .. entries.length - 1 when entries are non-empty. */
  index: number;
};

export type TabEntry = {
  id: string;
  history: HistoryStack;
};

export type ActiveSurface =
  | {kind: 'home'}
  | {kind: 'tab'; id: string};

export type WorkspaceState = {
  /** Editor tabs in display order. */
  tabs: ReadonlyArray<TabEntry>;
  /** Home back/forward stack; entries[0] is always this workspace's hub Today URI. */
  homeHistory: HistoryStack;
  /** Focused surface within this workspace (Home row vs a tab). */
  active: ActiveSurface;
};

export type WorkspaceModel = {
  /** Hub Today URI of the focused workspace, or null when the vault has no hubs. */
  activeHub: string | null;
  /** State per hub; keys are normalized hub Today URIs. */
  workspaces: Readonly<Record<string, WorkspaceState>>;
};

export function normalizeWorkspaceUri(uri: string): string {
  return uri.trim().replace(/\\/g, '/');
}

/** Default workspace: Home only at Today, no tabs. */
export function createDefaultWorkspaceState(hubUri: string): WorkspaceState {
  const hub = normalizeWorkspaceUri(hubUri);
  return {
    tabs: [],
    homeHistory: {entries: [hub], index: 0},
    active: {kind: 'home'},
  };
}
