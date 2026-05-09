/**
 * Editor workspace tab strip: foreground placement and shell mode decisions.
 *
 * Ownership: pure helpers for open-tab / hub-shell routing; callers own React state.
 */

import {vaultUriIsTodayMarkdownFile} from '../lib/vaultTreeLoadChildren';
import {
  createEditorWorkspaceTab,
  ensureActiveTabId,
  insertTabAfterActive,
  insertTabAtIndex,
  pushNavigateOnTab,
  tabsFromStored,
  tabsToStored,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';

/**
 * Decide whether a foreground open should use the hub workspace Home surface or normal tab navigation.
 */
export function decideHomeOpenMode(args: {
  targetNorm: string;
  activeTodayHubUri: string | null;
  activeEditorTabId?: string | null;
  options:
    | {home?: boolean; workspaceShell?: boolean; workspaceShellPreserveTabs?: boolean; newTab?: boolean}
    | undefined;
}): 'home' | 'normal' {
  const {targetNorm, activeTodayHubUri, activeEditorTabId, options} = args;
  if (options?.home === true) {
    return 'home';
  }
  if (options?.newTab === true) {
    return 'normal';
  }
  const activeHubNorm = normalizeEditorDocUri(activeTodayHubUri ?? '');
  const isActiveHubFile =
    activeHubNorm != null
    && activeHubNorm !== ''
    && targetNorm === activeHubNorm
    && vaultUriIsTodayMarkdownFile(targetNorm);
  if (!isActiveHubFile) {
    return 'normal';
  }
  if (activeEditorTabId == null) {
    return 'home';
  }
  if (options?.workspaceShell === true || options?.workspaceShellPreserveTabs === true) {
    return 'home';
  }
  return 'normal';
}

export const decideWorkspaceShellMode = decideHomeOpenMode;

/**
 * Place a target URI into the editor tab strip for the foreground open path:
 * either as a new active tab (with optional insertion index/position), or by
 * navigating the active tab's history when no `newTab` is requested.
 */
export function applyForegroundOpenTabPlacement(args: {
  uri: string;
  targetNorm: string;
  tabs: readonly EditorWorkspaceTab[];
  activeId: string | null;
  options:
    | {
        newTab?: boolean;
        activateNewTab?: boolean;
        insertAfterActive?: boolean;
        insertAtIndex?: number;
        skipHistory?: boolean;
      }
    | undefined;
}): {nextTabs: EditorWorkspaceTab[]; nextActiveId: string | null} {
  const {uri, targetNorm, tabs, activeId, options} = args;
  const wantNewTab = options?.newTab === true && options?.activateNewTab !== false;
  if (wantNewTab) {
    const newTab = createEditorWorkspaceTab(targetNorm);
    if (
      typeof options?.insertAtIndex === 'number'
      && Number.isFinite(options.insertAtIndex)
    ) {
      return {
        nextTabs: insertTabAtIndex(tabs, options.insertAtIndex, newTab),
        nextActiveId: newTab.id,
      };
    }
    if (options?.insertAfterActive) {
      return {
        nextTabs: insertTabAfterActive(tabs, activeId, newTab),
        nextActiveId: newTab.id,
      };
    }
    return {nextTabs: [...tabs, newTab], nextActiveId: newTab.id};
  }
  const ensuredActive = ensureActiveTabId(tabs, activeId);
  if (ensuredActive == null) {
    const first = createEditorWorkspaceTab(targetNorm);
    return {nextTabs: [first], nextActiveId: first.id};
  }
  const navigated = tabs.map(t => {
    if (t.id !== ensuredActive) return t;
    if (options?.skipHistory) return t;
    return pushNavigateOnTab(t, uri);
  });
  return {nextTabs: navigated, nextActiveId: ensuredActive};
}

export function cloneEditorWorkspaceTabs(
  tabs: readonly EditorWorkspaceTab[],
): EditorWorkspaceTab[] {
  return tabsFromStored(tabsToStored(tabs));
}
