import {vaultUriIsTodayMarkdownFile} from '@eskerra/core';

import {normalizeEditorDocUri} from './editorDocumentHistory';
import {tabCurrentUri, type EditorWorkspaceTab} from './editorWorkspaceTabs';
import {
  createWorkspaceHomeState,
  homeCanGoBack,
  homeCurrentUri,
  type WorkspaceHomeState,
} from './workspaceHomeNavigation';

export type SelectNoteActiveHubTodayOpen =
  /** Load active hub Today as the implicit workspace Home surface. */
  | 'home';

/**
 * After `findTabIdWithCurrentUri` is null: how `selectNote` should open the active hub Today.
 * Returns `null` when `uri` is not the active workspace home Today.
 */
export function selectNoteActiveHubTodayOpen(input: {
  uri: string;
  activeTodayHubUri: string | null;
  uriIsTodayMarkdownFile: boolean;
  editorWorkspaceTabCount?: number;
}): SelectNoteActiveHubTodayOpen | null {
  if (input.activeTodayHubUri == null || !input.uriIsTodayMarkdownFile) {
    return null;
  }
  const normUri = normalizeEditorDocUri(input.uri);
  const normHub = normalizeEditorDocUri(input.activeTodayHubUri);
  if (!normUri || !normHub || normUri !== normHub) {
    return null;
  }
  return 'home';
}

/** True when the URI should open as the implicit active workspace Home surface. */
export function shouldOpenActiveHubTodayAsHome(input: {
  uri: string;
  activeTodayHubUri: string | null;
  uriIsTodayMarkdownFile: boolean;
  editorWorkspaceTabCount?: number;
}): boolean {
  return selectNoteActiveHubTodayOpen(input) === 'home';
}

function noteTitleFromUri(uri: string): string {
  const normalized = uri.replace(/\\/g, '/');
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  return fileName.replace(/\.md$/i, '') || fileName || uri;
}

/**
 * URI for the workspace selector sub-label when Home has navigated past hub Today (entries[0]).
 * Independent of whether the user is currently viewing Home or an editor tab.
 */
export function workspaceSelectorSubLabelSourceUri(input: {
  activeTodayHubUri: string | null;
  homeState: WorkspaceHomeState | undefined;
}): string | null {
  if (input.activeTodayHubUri == null) {
    return null;
  }
  const home =
    input.homeState ?? createWorkspaceHomeState(input.activeTodayHubUri);
  if (!homeCanGoBack(home)) {
    return null;
  }
  return homeCurrentUri(home);
}

/** Title bar sub-label text for the workspace selector; undefined when Home is at hub Today. */
export function workspaceSelectorSubLabelText(input: {
  activeTodayHubUri: string | null;
  homeState: WorkspaceHomeState | undefined;
}): string | undefined {
  const uri = workspaceSelectorSubLabelSourceUri(input);
  return uri == null ? undefined : noteTitleFromUri(uri);
}

/**
 * Title bar: workspace main control uses active tab pill styling only on the Home surface when
 * Home history is past hub Today (see plan: workspace-selector as its own surface).
 */
export function workspaceSelectorMainShowsActiveTabPill(input: {
  composingNewEntry: boolean;
  activeTodayHubUri: string | null;
  activeEditorTabId: string | null;
  homeState: WorkspaceHomeState | undefined;
}): boolean {
  if (
    input.composingNewEntry
    || input.activeTodayHubUri == null
    || input.activeEditorTabId != null
  ) {
    return false;
  }
  const home =
    input.homeState ?? createWorkspaceHomeState(input.activeTodayHubUri);
  return homeCanGoBack(home);
}

/**
 * Title bar: workspace main control uses the same active chrome as an editor tab pill.
 * @deprecated Prefer {@link workspaceSelectorMainShowsActiveTabPill} for workspace-selector chrome.
 */
export function workspaceSelectShowsActiveTabPillState(input: {
  composingNewEntry: boolean;
  activeTodayHubUri: string | null;
  selectedUri: string | null;
  editorWorkspaceTabs: readonly EditorWorkspaceTab[];
}): boolean {
  if (
    input.composingNewEntry
    || !input.activeTodayHubUri
    || !input.selectedUri
  ) {
    return false;
  }
  const hub = normalizeEditorDocUri(input.activeTodayHubUri);
  const sel = normalizeEditorDocUri(input.selectedUri);
  if (
    !hub
    || !sel
    || hub !== sel
    || !vaultUriIsTodayMarkdownFile(sel)
  ) {
    return false;
  }
  return !input.editorWorkspaceTabs.some(t => {
    const cur = tabCurrentUri(t);
    return cur != null && normalizeEditorDocUri(cur) === hub;
  });
}

/** True when the active editor surface is workspace Home rather than an editor tab. */
export function isOnWorkspaceHome(input: {
  composingNewEntry: boolean;
  activeTodayHubUri: string | null;
  selectedUri: string | null;
  activeEditorTabId?: string | null;
}): boolean {
  if (
    input.composingNewEntry
    || input.activeEditorTabId != null
    || !input.activeTodayHubUri
    || !input.selectedUri
  ) {
    return false;
  }
  const hub = normalizeEditorDocUri(input.activeTodayHubUri);
  const sel = normalizeEditorDocUri(input.selectedUri);
  if (!hub || !sel) {
    return false;
  }
  return sel === hub || vaultUriIsTodayMarkdownFile(hub);
}

export const shouldOpenActiveHubTodayAsShell = shouldOpenActiveHubTodayAsHome;
export const isActiveWorkspaceTodayLinkSurface = isOnWorkspaceHome;
