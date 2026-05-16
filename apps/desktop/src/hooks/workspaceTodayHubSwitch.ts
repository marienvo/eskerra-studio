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

/** Payload for `UseWorkspaceTodayHubSwitchArgs.callbacks.syncWorkspaceModelForIncomingHub`. */
export type SyncWorkspaceModelForHubSwitchPayload = {
  outgoing?: {
    hubUri: string;
    nextTabs: readonly EditorWorkspaceTab[];
    nextActive: string | null;
    snapshot: TodayHubWorkspaceSnapshot;
  };
  incoming: {
    hubUri: string;
    nextTabs: readonly EditorWorkspaceTab[];
    nextActive: string | null;
    snapshot: TodayHubWorkspaceSnapshot | undefined;
  };
};

function snapshotTodayHubWorkspace(
  tabs: readonly EditorWorkspaceTab[],
  activeEditorTabId: string | null,
  home: WorkspaceHomeState | undefined,
): TodayHubWorkspaceSnapshot {
  return {
    editorWorkspaceTabs: tabsToStored(tabs),
    activeEditorTabId,
    ...(home != null
      ? {
          homeHistory: {
            entries: [...home.history.entries],
            index: home.history.index,
          },
        }
      : {}),
  };
}

function restoreTabsFromSnapshot(
  snap: TodayHubWorkspaceSnapshot | undefined,
): {nextTabs: EditorWorkspaceTab[]; nextActive: string | null} {
  const snapTabs = snap?.editorWorkspaceTabs;
  if (snapTabs == null || snapTabs.length === 0) {
    return {nextTabs: [], nextActive: null};
  }
  const nextTabs = cloneEditorWorkspaceTabs(tabsFromStored(snapTabs));
  return {
    nextTabs,
    nextActive: ensureActiveTabId(nextTabs, snap?.activeEditorTabId ?? null),
  };
}

export type UseWorkspaceTodayHubSwitchArgs = {
  state: {
    legacyTodayHubWorkspacesForSwitch: Record<string, TodayHubWorkspaceSnapshot>;
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
    setEditorWorkspaceTabs: (tabs: EditorWorkspaceTab[]) => void;
    setActiveEditorTabId: (id: string | null) => void;
    setActiveTodayHubUri: (uri: string | null) => void;
  };
  callbacks: {
    selectNote: (uri: string) => void;
    selectHomeCurrentNote: (todayNoteUri: string) => void | Promise<void>;
    activateOpenTab?: (tabId: string) => void;
    /** Main workspace selector control (title bar): branch per active surface / home index. */
    activateWorkspaceHomeSelector: () => void;
    mirrorShadowActiveHub?: (hubUri: string | null, reason: string) => void;
    mirrorShadowHomeSurface?: (reason: string) => void;
    mirrorShadowActiveTab?: (tabId: string, reason: string) => void;
    mirrorShadowActiveWorkspaceTabs?: (
      tabs: readonly EditorWorkspaceTab[],
      activeId: string | null,
      reason: string,
    ) => void;
    /**
     * Applies outgoing hub workspace (when switching away) then incoming hub to the shadow
     * {@link WorkspaceModel} in one synchronous dispatch. When set, mirror callbacks are skipped.
     */
    syncWorkspaceModelForIncomingHub?: (payload: SyncWorkspaceModelForHubSwitchPayload) => void;
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
    activateWorkspaceHomeSelector,
    mirrorShadowActiveHub,
    mirrorShadowHomeSurface,
    mirrorShadowActiveWorkspaceTabs,
    syncWorkspaceModelForIncomingHub,
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
    setEditorWorkspaceTabs,
    setActiveEditorTabId,
    setActiveTodayHubUri,
  } = args.setters;

  const {legacyTodayHubWorkspacesForSwitch} = args.state;

  const legacyTodayHubWorkspacesForSwitchRef = useRef(legacyTodayHubWorkspacesForSwitch);
  useLayoutEffect(() => {
    legacyTodayHubWorkspacesForSwitchRef.current = legacyTodayHubWorkspacesForSwitch;
  }, [legacyTodayHubWorkspacesForSwitch]);

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
      let outgoingForModel: SyncWorkspaceModelForHubSwitchPayload['outgoing'];
      if (old != null && old !== norm) {
        const outgoingSnap = snapshotTodayHubWorkspace(
          editorWorkspaceTabsRef.current,
          activeEditorTabIdRef.current,
          homeStatesByHubRef.current[old],
        );
        // Merge outgoing hub into the ref immediately so a second hub switch in the same
        // outer task (before React commits / before useLayoutEffect syncs props) still sees
        // the just-saved workspace.
        legacyTodayHubWorkspacesForSwitchRef.current = {
          ...legacyTodayHubWorkspacesForSwitchRef.current,
          [old]: outgoingSnap,
        };
        outgoingForModel = {
          hubUri: old,
          nextTabs: editorWorkspaceTabsRef.current,
          nextActive: activeEditorTabIdRef.current,
          snapshot: outgoingSnap,
        };
      }
      const snapForTarget = legacyTodayHubWorkspacesForSwitchRef.current[norm];

      const {nextTabs} = restoreTabsFromSnapshot(snapForTarget);

      if (syncWorkspaceModelForIncomingHub) {
        syncWorkspaceModelForIncomingHub({
          outgoing: outgoingForModel,
          incoming: {
            hubUri: norm,
            nextTabs,
            nextActive: null,
            snapshot: snapForTarget,
          },
        });
      }

      // Tab strip + active tab + hub updates are intentionally interleaved before shadow mirrors;
      // centralizing only ref/setTabs would reorder versus hub/active legacy writes.
      editorWorkspaceTabsRef.current = nextTabs;
      activeEditorTabIdRef.current = null;
      activeTodayHubUriRef.current = norm;
      setEditorWorkspaceTabs(nextTabs);
      setActiveEditorTabId(null);
      setActiveTodayHubUri(norm);
      if (!syncWorkspaceModelForIncomingHub) {
        mirrorShadowActiveHub?.(norm, 'switch workspace active hub');
        mirrorShadowActiveWorkspaceTabs?.(
          nextTabs,
          null,
          'switch workspace tabs',
        );
        mirrorShadowHomeSurface?.('switch workspace home surface');
      }
      await selectHomeCurrentNote(norm);
    },
    [
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
      mirrorShadowActiveWorkspaceTabs,
      mirrorShadowHomeSurface,
      syncWorkspaceModelForIncomingHub,
      selectHomeCurrentNote,
      setActiveEditorTabId,
      setActiveTodayHubUri,
      setComposingNewEntry,
      setEditorBody,
      setEditorWorkspaceTabs,
      setInboxEditorResetNonce,
      setInboxEditorYamlLeadingBeforeFrontmatter,
      setInboxYamlFrontmatterInner,
      legacyTodayHubWorkspacesForSwitchRef,
      vaultMarkdownRefsRef,
    ],
  );

  const focusActiveTodayHubNote = useCallback(() => {
    activateWorkspaceHomeSelector();
  }, [activateWorkspaceHomeSelector]);

  return {switchTodayHubWorkspace, focusActiveTodayHubNote};
}
