import {
  getGeneralDirectoryUri,
  getInboxDirectoryUri,
  type InboxWikiLinkNoteRef,
  type VaultMarkdownRef,
} from '@eskerra/core';

export const CANNOT_CREATE_PARENT_ERROR_MESSAGE =
  'That file was not found on disk (check spelling and special characters). Notebox cannot create notes inside dot-prefixed hidden folders (names starting with .).';

export function pickVaultLinkFallbackSource(args: {
  base: string;
  composingNewEntry: boolean;
  showTodayHubCanvas: boolean;
  todayHubWikiNavParent: string | null;
  selectedUri: string | null;
}): string {
  const {
    base,
    composingNewEntry,
    showTodayHubCanvas,
    todayHubWikiNavParent,
    selectedUri,
  } = args;
  if (composingNewEntry) {
    return getInboxDirectoryUri(base);
  }
  if (showTodayHubCanvas) {
    return getGeneralDirectoryUri(base);
  }
  return todayHubWikiNavParent ?? selectedUri ?? getInboxDirectoryUri(base);
}

export function canonicalWikiPathReplacementInner(
  inner: string,
  canonicalHref: string,
): string {
  const pipeAt = inner.indexOf('|');
  return pipeAt >= 0 ? `${canonicalHref}${inner.slice(pipeAt)}` : canonicalHref;
}

export function pickLinkReplacementSurface(args: {
  hasTodayHubCellEditor: boolean;
  todayHubWikiNavParent: string | null;
}): 'todayHubCell' | 'inbox' {
  return args.hasTodayHubCellEditor && args.todayHubWikiNavParent != null
    ? 'todayHubCell'
    : 'inbox';
}

export type WorkspaceLinkOpenMarkdownInEditor = (
  uri: string,
  options?: {
    newTab?: boolean;
    activateNewTab?: boolean;
    insertAfterActive?: boolean;
    home?: boolean;
  },
) => Promise<void>;

export function projectVaultMarkdownNoteRefs(
  refs: VaultMarkdownRef[],
): InboxWikiLinkNoteRef[] {
  return refs.map(r => ({name: r.name, uri: r.uri}));
}
