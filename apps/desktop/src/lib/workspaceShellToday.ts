import {normalizeEditorDocUri} from './editorDocumentHistory';
import {tabCurrentUri, type EditorWorkspaceTab} from './editorWorkspaceTabs';
import {vaultUriIsTodayMarkdownFile} from '@eskerra/core';

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

/**
 * Title bar: workspace main control uses the same active chrome as an editor tab pill.
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
