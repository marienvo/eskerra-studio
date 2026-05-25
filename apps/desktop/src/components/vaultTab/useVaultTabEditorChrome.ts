/**
 * Editor pane derived data: link contexts, title, backlinks, scroll restore.
 */
import {useLayoutEffect, useMemo, type RefObject} from 'react';

import type {VaultMarkdownRef} from '@eskerra/core';

import type {InboxEditorShellScrollDirective} from '../../hooks/workspaceEditorScrollMap';
import {buildVaultTabBacklinkRows} from '../vaultTabBacklinkRows';
import {buildVaultTabEditorAndComposeLinkDerivedData} from '../vaultTabLinkContexts';
import type {VaultTabNoteRow} from '../vaultTabTypes';

export type UseVaultTabEditorChromeArgs = {
  vaultRoot: string;
  vaultMarkdownRefs: readonly VaultMarkdownRef[];
  selectedUri: string | null;
  showTodayHubCanvas: boolean;
  notes: readonly VaultTabNoteRow[];
  backlinkUris: readonly string[];
  editorBody: string;
  inboxContentByUri: Record<string, string>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  inboxEditorShellScrollDirectiveRef: RefObject<InboxEditorShellScrollDirective | null>;
};

export function useVaultTabEditorChrome({
  vaultRoot,
  vaultMarkdownRefs,
  selectedUri,
  showTodayHubCanvas,
  notes,
  backlinkUris,
  editorBody,
  inboxContentByUri,
  inboxEditorShellScrollRef,
  inboxEditorShellScrollDirectiveRef,
}: UseVaultTabEditorChromeArgs) {
  const {mainEditor: mainEditorLinkDerived, composeDialog: composeDialogLinkDerived} =
    useMemo(
      () =>
        buildVaultTabEditorAndComposeLinkDerivedData({
          vaultRoot,
          vaultMarkdownRefs,
          selectedUri,
          showTodayHubCanvas,
        }),
      [vaultRoot, vaultMarkdownRefs, selectedUri, showTodayHubCanvas],
    );

  const editorPaneTitle = useMemo(() => {
    if (!selectedUri) {
      return 'Editor';
    }
    const row = notes.find(n => n.uri === selectedUri);
    if (row) {
      return row.name;
    }
    const tail = selectedUri.split(/[/\\]/).pop()?.trim();
    return tail || 'Editor';
  }, [notes, selectedUri]);

  const backlinkRows = useMemo(
    () =>
      buildVaultTabBacklinkRows({
        backlinkUris,
        vaultMarkdownRefs,
        composingNewEntry: false,
        selectedUri,
        editorBody,
        inboxContentByUri,
      }),
    [backlinkUris, vaultMarkdownRefs, selectedUri, editorBody, inboxContentByUri],
  );

  const editorOpen = Boolean(selectedUri);

  useLayoutEffect(() => {
    if (!editorOpen) {
      return;
    }
    const el = inboxEditorShellScrollRef.current;
    if (!el) {
      return;
    }
    const directive = inboxEditorShellScrollDirectiveRef.current;
    if (directive == null) {
      return;
    }
    inboxEditorShellScrollDirectiveRef.current = null;
    const apply = () => {
      if (directive.kind === 'snapTop') {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      } else {
        el.scrollTop = directive.top;
        el.scrollLeft = directive.left;
      }
    };
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [
    editorOpen,
    selectedUri,
    inboxEditorShellScrollDirectiveRef,
    inboxEditorShellScrollRef,
  ]);

  return {
    mainEditorLinkDerived,
    composeDialogLinkDerived,
    editorPaneTitle,
    backlinkRows,
    editorOpen,
  };
}
