import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import {sortedTodayHubNoteUrisFromRefs, type VaultMarkdownRef} from '@eskerra/core';

import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {
  ensureActiveTabId,
  tabsFromStored,
  tabsToStored,
  type EditorWorkspaceTab,
} from '../lib/editorWorkspaceTabs';
import {clearInboxYamlFrontmatterEditorRefs} from '../lib/inboxYamlFrontmatterEditor';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import type {WorkspaceHomeState} from '../lib/workspaceHomeNavigation';
import {cloneEditorWorkspaceTabs} from './workspaceEditorTabs';

export type UseWorkspaceTodayHubSwitchArgs = {
  state: {
    todayHubWorkspacesForSave: Record<string, TodayHubWorkspaceSnapshot>;
  };
  refs: {
    vaultMarkdownRefsRef: MutableRefObject<readonly VaultMarkdownRef[]>;
    activeTodayHubUriRef: MutableRefObject<string | null>;
    flushInboxSaveRef: MutableRefObject<() => Promise<void>>;
    composingNewEntryRef: MutableRefObject<boolean>;
    inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
    inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
    editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
    activeEditorTabIdRef: MutableRefObject<string | null>;
    homeStatesByHubRef: MutableRefObject<Record<string, WorkspaceHomeState>>;
  };
  setters: {
    setComposingNewEntry: (next: boolean) => void;
    setInboxYamlFrontmatterInner: (next: string | null) => void;
    setInboxEditorYamlLeadingBeforeFrontmatter: (next: string) => void;
    setEditorBody: (body: string) => void;
    setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
    setTodayHubWorkspacesForSave: Dispatch<
      SetStateAction<Record<string, TodayHubWorkspaceSnapshot>>
    >;
    setEditorWorkspaceTabs: (tabs: EditorWorkspaceTab[]) => void;
    setActiveEditorTabId: (id: string | null) => void;
    setActiveTodayHubUri: (uri: string | null) => void;
  };
  callbacks: {
    selectNote: (uri: string) => void;
    selectHomeCurrentNote: (todayNoteUri: string) => void | Promise<void>;
    activateOpenTab: (tabId: string) => void;
    /** Main workspace selector control (title bar): branch per active surface / home index. */
    activateWorkspaceHomeSelector: () => void;
    mirrorShadowActiveHub?: (hubUri: string | null, reason: string) => void;
    mirrorShadowHomeSurface?: (reason: string) => void;
    mirrorShadowActiveTab?: (tabId: string, reason: string) => void;
  };
};

export type UseWorkspaceTodayHubSwitchResult = {
  switchTodayHubWorkspace: (todayNoteUri: string) => Promise<void>;
  focusActiveTodayHubNote: () => void;
};

export function useWorkspaceTodayHubSwitch(
  args: UseWorkspaceTodayHubSwitchArgs,
): UseWorkspaceTodayHubSwitchResult {
  const {
    selectHomeCurrentNote,
    activateOpenTab,
    activateWorkspaceHomeSelector,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveTab,
  } = args.callbacks;

  const {
    vaultMarkdownRefsRef,
    activeTodayHubUriRef,
    flushInboxSaveRef,
    composingNewEntryRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    editorWorkspaceTabsRef,
    activeEditorTabIdRef,
    homeStatesByHubRef,
  } = args.refs;

  const {
    setComposingNewEntry,
    setInboxYamlFrontmatterInner,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    setEditorBody,
    setInboxEditorResetNonce,
    setTodayHubWorkspacesForSave,
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setActiveTodayHubUri,
  } = args.setters;

  const {todayHubWorkspacesForSave} = args.state;

  const todayHubWorkspacesForSaveRef = useRef(todayHubWorkspacesForSave);
  useLayoutEffect(() => {
    todayHubWorkspacesForSaveRef.current = todayHubWorkspacesForSave;
  }, [todayHubWorkspacesForSave]);

  const switchTodayHubWorkspace = useCallback(
    async (todayNoteUri: string) => {
      const norm = normalizeEditorDocUri(todayNoteUri);
      if (!norm) {
        return;
      }
      const hubs = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefsRef.current);
      if (!hubs.includes(norm)) {
        return;
      }
      if (norm === activeTodayHubUriRef.current) {
        activateWorkspaceHomeSelector();
        return;
      }

      await flushInboxSaveRef.current();
      if (composingNewEntryRef.current) {
        composingNewEntryRef.current = false;
        setComposingNewEntry(false);
        clearInboxYamlFrontmatterEditorRefs({
          inner: inboxYamlFrontmatterInnerRef,
          leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
          setInner: setInboxYamlFrontmatterInner,
          setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
        });
        setEditorBody('');
        setInboxEditorResetNonce(n => n + 1);
      }

      const old = activeTodayHubUriRef.current;
      let snapForTarget: TodayHubWorkspaceSnapshot | undefined;
      if (old != null && old !== norm) {
        const oldHome = homeStatesByHubRef.current[old];
        const outgoingSnap: TodayHubWorkspaceSnapshot = {
          editorWorkspaceTabs: tabsToStored(editorWorkspaceTabsRef.current),
          activeEditorTabId: activeEditorTabIdRef.current,
          ...(oldHome != null
            ? {
                homeHistory: {
                  entries: [...oldHome.history.entries],
                  index: oldHome.history.index,
                },
              }
            : {}),
        };
        // Merge outgoing hub into the ref immediately so a second hub switch in the same
        // outer task (before React commits / before useLayoutEffect syncs props) still sees
        // the just-saved workspace. The functional updater reads `snapForTarget` from latest
        // queued `prev` when React runs it; we also mirror `next` into the ref there.
        todayHubWorkspacesForSaveRef.current = {
          ...todayHubWorkspacesForSaveRef.current,
          [old]: outgoingSnap,
        };
        setTodayHubWorkspacesForSave(prev => {
          snapForTarget = prev[norm];
          const next: Record<string, TodayHubWorkspaceSnapshot> = {
            ...prev,
            [old]: outgoingSnap,
          };
          todayHubWorkspacesForSaveRef.current = next;
          return next;
        });
      }
      snapForTarget =
        snapForTarget ?? todayHubWorkspacesForSaveRef.current[norm];

      const snapTabs = snapForTarget?.editorWorkspaceTabs;
      let nextTabs: EditorWorkspaceTab[];
      let nextActive: string | null;
      if (snapTabs != null && snapTabs.length > 0) {
        nextTabs = cloneEditorWorkspaceTabs(tabsFromStored(snapTabs));
        nextActive = ensureActiveTabId(
          nextTabs,
          snapForTarget?.activeEditorTabId ?? null,
        );
      } else {
        nextTabs = [];
        nextActive = null;
      }

      editorWorkspaceTabsRef.current = nextTabs;
      activeEditorTabIdRef.current = nextActive;
      setEditorWorkspaceTabs(nextTabs);
      setActiveEditorTabId(nextActive);
      activeTodayHubUriRef.current = norm;
      setActiveTodayHubUri(norm);
      mirrorShadowActiveHub?.(norm, 'switch workspace active hub');
      if (nextActive) {
        mirrorShadowActiveTab?.(nextActive, 'switch workspace active tab');
      } else {
        mirrorShadowHomeSurface?.('switch workspace home surface');
      }
      // Do not `selectNote(norm)` when B has restored tabs: that would navigate the
      // active tab to B's Today and overwrite e.g. a tab that was still showing A's hub note.
      if (nextTabs.length === 0) {
        await selectHomeCurrentNote(norm);
      } else if (nextActive) {
        activateOpenTab(nextActive);
      } else {
        await selectHomeCurrentNote(norm);
      }
    },
    [
      activateOpenTab,
      activateWorkspaceHomeSelector,
      activeEditorTabIdRef,
      activeTodayHubUriRef,
      composingNewEntryRef,
      editorWorkspaceTabsRef,
      flushInboxSaveRef,
      homeStatesByHubRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      inboxYamlFrontmatterInnerRef,
      mirrorShadowActiveHub,
      mirrorShadowActiveTab,
      mirrorShadowHomeSurface,
      selectHomeCurrentNote,
      setActiveEditorTabId,
      setActiveTodayHubUri,
      setComposingNewEntry,
      setEditorBody,
      setEditorWorkspaceTabs,
      setInboxEditorResetNonce,
      setInboxEditorYamlLeadingBeforeFrontmatter,
      setInboxYamlFrontmatterInner,
      setTodayHubWorkspacesForSave,
      todayHubWorkspacesForSaveRef,
      vaultMarkdownRefsRef,
    ],
  );

  const focusActiveTodayHubNote = useCallback(() => {
    activateWorkspaceHomeSelector();
  }, [activateWorkspaceHomeSelector]);

  return {switchTodayHubWorkspace, focusActiveTodayHubNote};
}
