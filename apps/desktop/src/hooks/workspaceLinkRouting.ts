import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  getGeneralDirectoryUri,
  getInboxDirectoryUri,
  isBrowserOpenableMarkdownHref,
  normalizeVaultBaseUri,
  wikiLinkInnerBrowserOpenableHref,
  wikiLinkInnerVaultRelativeMarkdownHref,
  type SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {
  VaultRelativeMarkdownLinkActivatePayload,
  VaultWikiLinkActivatePayload,
} from '../editor/noteEditor/vaultLinkActivatePayload';
import {
  findTabIdWithCurrentUri,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {
  openOrCreateInboxWikiLinkTarget,
  openOrCreateVaultRelativeMarkdownLink,
  openOrCreateVaultWikiPathMarkdownLink,
} from '../lib/inboxWikiLinkNavigation';
import {openSystemBrowserUrl} from '../lib/openSystemBrowserUrl';
import {isActiveWorkspaceTodayLinkSurface} from '../lib/workspaceShellToday';

import type {WorkspaceLinkController} from './workspaceReturnShape';

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
  },
) => Promise<void>;

export function useWorkspaceLinkRouting(args: {
  vaultRoot: string | null;
  fs: VaultFilesystem;
  flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
  vaultMarkdownRefsRef: MutableRefObject<VaultMarkdownRef[]>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  showTodayHubCanvasRef: MutableRefObject<boolean>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  todayHubCellEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  activeTodayHubUriRef: MutableRefObject<string | null>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  openMarkdownInEditor: WorkspaceLinkOpenMarkdownInEditor;
  activateOpenTab: (tabId: string) => void;
  tryEnterBackupMergeView: (uri: string) => Promise<boolean>;
  refreshNotes: (root: string) => Promise<void>;
  setErr: (value: string | null) => void;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
}): WorkspaceLinkController {
  const {
    vaultRoot,
    fs,
    flushInboxSaveRef,
    vaultMarkdownRefsRef,
    selectedUriRef,
    composingNewEntryRef,
    showTodayHubCanvasRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    activeTodayHubUriRef,
    editorWorkspaceTabsRef,
    inboxEditorRef,
    openMarkdownInEditor,
    activateOpenTab,
    tryEnterBackupMergeView,
    refreshNotes,
    setErr,
    setFsRefreshNonce,
    subtreeMarkdownCache,
  } = args;

  /**
   * Shared "new-tab" routing used by wiki-link and relative-markdown-link activation.
   *
   * - If the target is already open in any tab, that tab is focused (no duplicate).
   * - Otherwise a new tab is opened: foreground (`activateNewTab: true`) or background.
   */
  const openNoteRespectingExistingTab = useCallback(
    async (uri: string, mode: 'foreground-new-tab' | 'background-new-tab') => {
      const existingTabId = findTabIdWithCurrentUri(editorWorkspaceTabsRef.current, uri);
      if (existingTabId != null) {
        activateOpenTab(existingTabId);
        return;
      }
      await openMarkdownInEditor(uri, {
        newTab: true,
        activateNewTab: mode === 'foreground-new-tab',
        insertAfterActive: true,
      });
    },
    [activateOpenTab, editorWorkspaceTabsRef, openMarkdownInEditor],
  );

  /**
   * After a vault link resolves to a target URI, route to the right surface:
   * backup merge view, background new tab, foreground new tab on Today surfaces, or normal editor.
   */
  const routeOpenedVaultLink = useCallback(
    async (
      uri: string,
      options: {openInBackgroundTab: boolean; allowBackupMergeView: boolean},
    ): Promise<void> => {
      if (options.allowBackupMergeView && (await tryEnterBackupMergeView(uri))) {
        return;
      }
      if (options.openInBackgroundTab) {
        await openNoteRespectingExistingTab(uri, 'background-new-tab');
        return;
      }
      if (
        isActiveWorkspaceTodayLinkSurface({
          composingNewEntry: composingNewEntryRef.current,
          activeTodayHubUri: activeTodayHubUriRef.current,
          selectedUri: selectedUriRef.current,
        })
      ) {
        await openNoteRespectingExistingTab(uri, 'foreground-new-tab');
        return;
      }
      await openMarkdownInEditor(uri);
    },
    [
      tryEnterBackupMergeView,
      openNoteRespectingExistingTab,
      openMarkdownInEditor,
      composingNewEntryRef,
      activeTodayHubUriRef,
      selectedUriRef,
    ],
  );

  /** Apply a canonical wiki-link inner replacement to the right editor (Today Hub cell or main inbox). */
  const replaceWikiLinkInnerAtTargetEditor = useCallback(
    (at: number, expectedInner: string, replacementInner: string) => {
      const hubEd = todayHubCellEditorRef.current;
      const surface = pickLinkReplacementSurface({
        hasTodayHubCellEditor: hubEd != null,
        todayHubWikiNavParent: todayHubWikiNavParentRef.current,
      });
      if (surface === 'todayHubCell') {
        hubEd?.replaceWikiLinkInnerAt({at, expectedInner, replacementInner});
        return;
      }
      inboxEditorRef.current?.replaceWikiLinkInnerAt({at, expectedInner, replacementInner});
    },
    [inboxEditorRef, todayHubCellEditorRef, todayHubWikiNavParentRef],
  );

  /**
   * Wiki-link target rejected for `path_not_supported`: try opening or creating it as a relative
   * markdown link via `openOrCreateVaultWikiPathMarkdownLink`. Returns whether the link was handled.
   */
  const handleWikiLinkPathNotSupported = useCallback(
    async (args: {inner: string; at: number; openInBackgroundTab: boolean}): Promise<boolean> => {
      if (!vaultRoot) return false;
      const {inner, at, openInBackgroundTab} = args;
      const pathHref = wikiLinkInnerVaultRelativeMarkdownHref(inner);
      if (pathHref == null) {
        return false;
      }
      const base = normalizeVaultBaseUri(vaultRoot);
      const wikiPathFallbackSource = pickVaultLinkFallbackSource({
        base,
        composingNewEntry: composingNewEntryRef.current,
        showTodayHubCanvas: showTodayHubCanvasRef.current,
        todayHubWikiNavParent: todayHubWikiNavParentRef.current,
        selectedUri: selectedUriRef.current,
      });
      const relResult = await openOrCreateVaultWikiPathMarkdownLink({
        inner,
        notes: vaultMarkdownRefsRef.current.map(r => ({name: r.name, uri: r.uri})),
        vaultRoot,
        fs,
        fallbackSourceMarkdownUriOrDir: wikiPathFallbackSource,
      });
      if (relResult.kind === 'cannot_create_parent') {
        setErr(
          'That file was not found on disk (check spelling and special characters). Notebox cannot create notes inside dot-prefixed hidden folders (names starting with .).',
        );
        return true;
      }
      if (relResult.kind !== 'open' && relResult.kind !== 'created') {
        return false;
      }
      if (relResult.kind === 'created') {
        subtreeMarkdownCache.invalidateForMutation(vaultRoot, relResult.uri, 'file');
        await refreshNotes(vaultRoot);
        setFsRefreshNonce(n => n + 1);
      } else if (relResult.canonicalHref) {
        replaceWikiLinkInnerAtTargetEditor(
          at,
          inner,
          canonicalWikiPathReplacementInner(inner, relResult.canonicalHref),
        );
      }
      await routeOpenedVaultLink(relResult.uri, {
        openInBackgroundTab,
        allowBackupMergeView: relResult.kind === 'open',
      });
      return true;
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      replaceWikiLinkInnerAtTargetEditor,
      routeOpenedVaultLink,
      subtreeMarkdownCache,
      composingNewEntryRef,
      showTodayHubCanvasRef,
      todayHubWikiNavParentRef,
      selectedUriRef,
      vaultMarkdownRefsRef,
      setErr,
      setFsRefreshNonce,
    ],
  );

  const handleResolvedWikiLinkResult = useCallback(
    async (
      payload: {inner: string; at: number; openInBackgroundTab: boolean},
      result: Awaited<ReturnType<typeof openOrCreateInboxWikiLinkTarget>>,
    ): Promise<void> => {
      const {inner, at, openInBackgroundTab} = payload;
      if (!vaultRoot) return;
      if (result.kind === 'open' || result.kind === 'created') {
        if (result.kind === 'created') {
          subtreeMarkdownCache.invalidateForMutation(vaultRoot, result.uri, 'file');
          await refreshNotes(vaultRoot);
          setFsRefreshNonce(n => n + 1);
        } else if (result.canonicalInner) {
          replaceWikiLinkInnerAtTargetEditor(at, inner, result.canonicalInner);
        }
        await routeOpenedVaultLink(result.uri, {
          openInBackgroundTab,
          allowBackupMergeView: result.kind === 'open',
        });
        return;
      }
      if (result.kind === 'ambiguous') {
        const names = result.notes.map(n => n.name).join(', ');
        setErr(
          `Ambiguous wiki link target: "${inner}" matches multiple notes (${names}).`,
        );
        return;
      }
      if (result.kind === 'unsupported') {
        if (result.reason !== 'path_not_supported') {
          setErr('Wiki link target is empty.');
          return;
        }
        const handled = await handleWikiLinkPathNotSupported({
          inner,
          at,
          openInBackgroundTab,
        });
        if (!handled) {
          setErr(
            `Wiki link targets must be a single note name, not a path (link: "${inner}").`,
          );
        }
      }
    },
    [
      vaultRoot,
      refreshNotes,
      replaceWikiLinkInnerAtTargetEditor,
      routeOpenedVaultLink,
      handleWikiLinkPathNotSupported,
      subtreeMarkdownCache,
      setErr,
      setFsRefreshNonce,
    ],
  );

  const activateWikiLink = useCallback(
    async ({inner, at, openInBackgroundTab = false}: VaultWikiLinkActivatePayload) => {
      if (!vaultRoot) {
        return;
      }
      const browserHref = wikiLinkInnerBrowserOpenableHref(inner);
      if (browserHref != null) {
        openSystemBrowserUrl(browserHref.trim()).catch(e => {
          setErr(e instanceof Error ? e.message : String(e));
        });
        return;
      }
      await flushInboxSaveRef.current();
      try {
        const wikiParent = showTodayHubCanvasRef.current
          ? (todayHubWikiNavParentRef.current ?? selectedUriRef.current)
          : selectedUriRef.current;
        const todayHubNewNoteParent =
          showTodayHubCanvasRef.current && !composingNewEntryRef.current
            ? getGeneralDirectoryUri(normalizeVaultBaseUri(vaultRoot))
            : null;
        const result = await openOrCreateInboxWikiLinkTarget({
          inner,
          notes: vaultMarkdownRefsRef.current.map(r => ({name: r.name, uri: r.uri})),
          vaultRoot,
          fs,
          activeMarkdownUri: composingNewEntryRef.current ? null : wikiParent,
          newNoteParentDirectory: todayHubNewNoteParent,
        });
        await handleResolvedWikiLinkResult({inner, at, openInBackgroundTab}, result);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [
      vaultRoot,
      fs,
      handleResolvedWikiLinkResult,
      setErr,
      flushInboxSaveRef,
      showTodayHubCanvasRef,
      todayHubWikiNavParentRef,
      selectedUriRef,
      composingNewEntryRef,
      vaultMarkdownRefsRef,
    ],
  );

  const onWikiLinkActivate = useCallback(
    (payload: VaultWikiLinkActivatePayload) => {
      void activateWikiLink(payload);
    },
    [activateWikiLink],
  );

  const activateRelativeMarkdownLink = useCallback(
    async ({
      href,
      at,
      openInBackgroundTab = false,
    }: VaultRelativeMarkdownLinkActivatePayload) => {
      if (!vaultRoot) {
        return;
      }
      await flushInboxSaveRef.current();
      const base = normalizeVaultBaseUri(vaultRoot);
      const sourceMarkdownUriOrDir = pickVaultLinkFallbackSource({
        base,
        composingNewEntry: composingNewEntryRef.current,
        showTodayHubCanvas: showTodayHubCanvasRef.current,
        todayHubWikiNavParent: todayHubWikiNavParentRef.current,
        selectedUri: selectedUriRef.current,
      });
      try {
        const result = await openOrCreateVaultRelativeMarkdownLink({
          href,
          notes: vaultMarkdownRefsRef.current.map(r => ({
            name: r.name,
            uri: r.uri,
          })),
          vaultRoot,
          fs,
          sourceMarkdownUriOrDir,
        });
        if (result.kind === 'open' || result.kind === 'created') {
          if (result.kind === 'created') {
            subtreeMarkdownCache.invalidateForMutation(vaultRoot, result.uri, 'file');
            await refreshNotes(vaultRoot);
            setFsRefreshNonce(n => n + 1);
          } else if (result.canonicalHref) {
            const hubEd = todayHubCellEditorRef.current;
            const replacement = {
              at,
              expectedHref: href,
              replacementHref: result.canonicalHref,
            };
            const surface = pickLinkReplacementSurface({
              hasTodayHubCellEditor: hubEd != null,
              todayHubWikiNavParent: todayHubWikiNavParentRef.current,
            });
            if (surface === 'todayHubCell') {
              hubEd?.replaceMarkdownLinkHrefAt(replacement);
            } else {
              inboxEditorRef.current?.replaceMarkdownLinkHrefAt(replacement);
            }
          }
          await routeOpenedVaultLink(result.uri, {
            openInBackgroundTab,
            allowBackupMergeView: result.kind === 'open',
          });
          return;
        }
        if (result.kind === 'cannot_create_parent') {
          setErr(
            'That file was not found on disk (check spelling and special characters). Notebox cannot create notes inside dot-prefixed hidden folders (names starting with .).',
          );
          return;
        }
        setErr('This link is not a relative vault markdown note.');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [
      vaultRoot,
      fs,
      refreshNotes,
      inboxEditorRef,
      routeOpenedVaultLink,
      subtreeMarkdownCache,
      flushInboxSaveRef,
      composingNewEntryRef,
      showTodayHubCanvasRef,
      todayHubWikiNavParentRef,
      selectedUriRef,
      vaultMarkdownRefsRef,
      setErr,
      setFsRefreshNonce,
      todayHubCellEditorRef,
    ],
  );

  const onMarkdownRelativeLinkActivate = useCallback(
    (payload: VaultRelativeMarkdownLinkActivatePayload) => {
      void activateRelativeMarkdownLink(payload);
    },
    [activateRelativeMarkdownLink],
  );

  const onMarkdownExternalLinkOpen = useCallback(
    (payload: {href: string; at: number}) => {
      const href = payload.href.trim();
      if (!isBrowserOpenableMarkdownHref(href)) {
        return;
      }
      openSystemBrowserUrl(href).catch(e => {
        setErr(e instanceof Error ? e.message : String(e));
      });
    },
    [setErr],
  );

  return {
    onWikiLinkActivate,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
  };
}
