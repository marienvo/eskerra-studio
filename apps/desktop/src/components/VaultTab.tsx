/**
 * Vault tab shell: layout, tree/episodes/editor split, dialogs, and editor pane composition.
 *
 * Ownership: UI composition + local dialog state; workspace policy lives in `useMainWindowWorkspace`.
 */
import type {
  MutableRefObject,
  RefObject,
} from 'react';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';

import {createNoteInboxAttachmentHost} from '../lib/noteInboxAttachmentHost';
import {countInboxVaultMarkdownRefs} from '../lib/countInboxVaultMarkdownRefs';
import {fireInboxClearedConfetti} from '../lib/fireInboxClearedConfetti';
import {resolveVaultImagePreviewUrl} from '../lib/resolveVaultImagePreviewUrl';

import {
  getInboxDirectoryUri,
  normalizeVaultBaseUri,
  trimTrailingSlashes,
  type EskerraSettings,
  type VaultFilesystem,
  type VaultMarkdownRef,
} from '@eskerra/core';

import {
  MIN_RESIZABLE_PANE_PX,
  NOTIFICATIONS_PANEL,
} from '../lib/layout/layoutStore';

import {
  FrontmatterEditor,
  type VaultFrontmatterIndexApi,
} from '../editor/frontmatterEditor/FrontmatterEditor';
import {useVaultFrontmatterIndex} from '../hooks/useVaultFrontmatterIndex';

import {
  NoteMarkdownEditor,
  type NoteMarkdownEditorHandle,
} from '../editor/noteEditor/NoteMarkdownEditor';

import {renameDraftStemForMarkdownUri} from '../lib/renameDialogDraft';
import type {VaultTreeBulkItem} from '../lib/vaultTreeBulkPlan';

import {
  todayHubColumnCount,
  type TodayHubSettings,
  type TodayHubWorkspaceBridge,
} from '../lib/todayHub';

import {DesktopHorizontalSplitEnd} from './DesktopHorizontalSplitEnd';
import {EditorPaneOpenNoteTabs} from './EditorPaneOpenNoteTabs';
import {EditorWorkspaceToolbar} from './EditorWorkspaceToolbar';
import {MainWorkspaceSplit} from './MainWorkspaceSplit';
import {MaterialIcon} from './MaterialIcon';
import {TodayHubCanvas} from './TodayHubCanvas';
import {VaultTreePane} from './VaultTreePane';
import {VaultTabDialogs} from './VaultTabDialogs';
import {VaultTabSideColumn} from './VaultTabSideColumn';
import {shouldHandleDeleteNoteGlobalShortcut} from './vaultTabDeleteNoteShortcut';
import {buildVaultTabBacklinkRows} from './vaultTabBacklinkRows';
import {
  buildVaultTabLinkDerivedData,
  type VaultTabWikiLinkCompletionCandidates,
} from './vaultTabLinkDerived';
import {buildVaultTabEditorPaneDerived} from './vaultTabEditorPaneDerived';
import type {
  VaultTabEnvironment,
  VaultTabEditorController,
  VaultTabFrontmatterController,
  VaultTabLayoutController,
  VaultTabLinkController,
  VaultTabMergeController,
  VaultTabNotificationsController,
  VaultTabPlaybackController,
  VaultTabTabsController,
  VaultTabTodayHubController,
  VaultTabTreeController,
} from './vaultTabTypes';
import {BackupMergePanel} from './BackupMergePanel';
import type {MergePanelSource} from './BackupMergePanel';

type DiskConflictPayload = {uri: string};

type VaultTabProps = {
  environment: VaultTabEnvironment;
  frontmatterController: VaultTabFrontmatterController;
  editorController: VaultTabEditorController;
  layoutController: VaultTabLayoutController;
  playbackController: VaultTabPlaybackController;
  linkController: VaultTabLinkController;
  treeController: VaultTabTreeController;
  mergeController: VaultTabMergeController;
  tabsController: VaultTabTabsController;
  notificationsController: VaultTabNotificationsController;
  todayHubController: VaultTabTodayHubController;
};

type InboxBacklinksSectionProps = {
  selectedUri: string;
  backlinkRows: readonly {uri: string; fileName: string; title: string}[];
  onSelectNote: (uri: string) => void;
  deferNonce: number;
};

type EditorPaneBodyProps = {
  fs: VaultFilesystem;
  mergeView:
    | null
    | {kind: 'backup'; baseUri: string; backupUri: string}
    | {kind: 'diskConflict'; baseUri: string; diskMarkdown: string};
  onCloseMergeView: () => void;
  onApplyFullBackupFromMerge: () => void | Promise<void>;
  onApplyMergedBodyFromMerge: (body: string) => void;
  onKeepMyEditsFromMerge?: () => void;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  inboxEditorShellScrollRef: RefObject<HTMLDivElement | null>;
  inboxAttachmentHost: ReturnType<typeof createNoteInboxAttachmentHost>;
  vaultRoot: string;
  vaultMarkdownRefs: VaultMarkdownRef[];
  inboxContentByUri: Record<string, string>;
  composingNewEntry: boolean;
  selectedUri: string | null;
  inboxYamlFrontmatterInner: string | null;
  applyFrontmatterInnerChange: (nextInner: string | null) => void;
  vaultFrontmatterIndex: VaultFrontmatterIndexApi;
  vaultSettings: EskerraSettings | null;
  diskConflict: DiskConflictPayload | null;
  editorBody: string;
  inboxEditorResetNonce: number;
  onEditorChange: VaultTabEditorController['onEditorChange'];
  onEditorError: VaultTabEditorController['onEditorError'];
  onWikiLinkActivate: VaultTabLinkController['onWikiLinkActivate'];
  onMarkdownRelativeLinkActivate: VaultTabLinkController['onMarkdownRelativeLinkActivate'];
  onMarkdownExternalLinkOpen: VaultTabLinkController['onMarkdownExternalLinkOpen'];
  relativeMarkdownLinkHrefIsResolved: (href: string) => boolean;
  wikiLinkTargetIsResolved: (inner: string) => boolean;
  wikiLinkCompletionCandidates: VaultTabWikiLinkCompletionCandidates;
  onSaveShortcut: VaultTabEditorController['onSaveShortcut'];
  onCleanNote?: VaultTabEditorController['onCleanNote'];
  onDeleteNoteShortcut: () => void;
  busy: boolean;
  backlinkRows: readonly {uri: string; fileName: string; title: string}[];
  onSelectNote: VaultTabEditorController['onSelectNote'];
  inboxBacklinksDeferNonce: number;
  showTodayHubCanvas: boolean;
  todayHubSettings: TodayHubSettings | null;
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  todayHubCellEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  prehydrateTodayHubRows: (rowUris: readonly string[]) => Promise<void>;
  persistTodayHubRow: (
    rowUri: string,
    mergedMarkdown: string,
    columnCount: number,
  ) => Promise<void>;
  todayHubCleanRowBlocked?: (rowUri: string) => boolean;
  linkSnippetBlockedDomains?: VaultTabLinkController['linkSnippetBlockedDomains'];
  onMuteLinkSnippetDomain?: VaultTabLinkController['onMuteLinkSnippetDomain'];
};

function useEditorPaneBodyDerived(
  mergeView: EditorPaneBodyProps['mergeView'],
  inboxContentByUri: EditorPaneBodyProps['inboxContentByUri'],
  selectedUri: EditorPaneBodyProps['selectedUri'],
  editorBody: string,
  showTodayHubCanvas: boolean,
  todayHubSettings: TodayHubSettings | null,
  composingNewEntry: boolean,
  busy: boolean,
  diskConflict: EditorPaneBodyProps['diskConflict'],
) {
  return useMemo(
    () =>
      buildVaultTabEditorPaneDerived({
        mergeView,
        inboxContentByUri,
        selectedUri,
        editorBody,
        showTodayHubCanvas,
        todayHubSettings,
        composingNewEntry,
        busy,
        diskConflict,
      }),
    [
      mergeView,
      inboxContentByUri,
      selectedUri,
      editorBody,
      showTodayHubCanvas,
      todayHubSettings,
      composingNewEntry,
      busy,
      diskConflict,
    ],
  );
}

type EditorPaneTodayHubBlockProps = {
  mergeView: EditorPaneBodyProps['mergeView'];
  showTodayHubCanvas: boolean;
  selectedUri: string | null;
  todayHubSettings: TodayHubSettings | null;
  composingNewEntry: boolean;
  todayHubSidecarRef: RefObject<HTMLDivElement | null>;
  vaultRoot: string;
  inboxContentByUri: Record<string, string>;
  vaultMarkdownRefs: VaultMarkdownRef[];
  todayHubBridgeRef: MutableRefObject<TodayHubWorkspaceBridge>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  todayHubCellEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  onWikiLinkActivate: EditorPaneBodyProps['onWikiLinkActivate'];
  onMarkdownRelativeLinkActivate: EditorPaneBodyProps['onMarkdownRelativeLinkActivate'];
  onMarkdownExternalLinkOpen: EditorPaneBodyProps['onMarkdownExternalLinkOpen'];
  onEditorError: EditorPaneBodyProps['onEditorError'];
  onSaveShortcut: EditorPaneBodyProps['onSaveShortcut'];
  prehydrateTodayHubRows: EditorPaneBodyProps['prehydrateTodayHubRows'];
  persistTodayHubRow: EditorPaneBodyProps['persistTodayHubRow'];
  todayHubCleanRowBlocked: EditorPaneBodyProps['todayHubCleanRowBlocked'];
  linkSnippetBlockedDomains: EditorPaneBodyProps['linkSnippetBlockedDomains'];
  onMuteLinkSnippetDomain: EditorPaneBodyProps['onMuteLinkSnippetDomain'];
};

function EditorPaneTodayHubBlock({
  mergeView,
  showTodayHubCanvas,
  selectedUri,
  todayHubSettings,
  composingNewEntry,
  todayHubSidecarRef,
  vaultRoot,
  inboxContentByUri,
  vaultMarkdownRefs,
  todayHubBridgeRef,
  todayHubWikiNavParentRef,
  todayHubCellEditorRef,
  onWikiLinkActivate,
  onMarkdownRelativeLinkActivate,
  onMarkdownExternalLinkOpen,
  onEditorError,
  onSaveShortcut,
  prehydrateTodayHubRows,
  persistTodayHubRow,
  todayHubCleanRowBlocked,
  linkSnippetBlockedDomains,
  onMuteLinkSnippetDomain,
}: EditorPaneTodayHubBlockProps) {
  if (
    !showTodayHubCanvas
    || !selectedUri
    || todayHubSettings == null
    || composingNewEntry
    || mergeView != null
  ) {
    return null;
  }
  return (
    <div
      ref={todayHubSidecarRef}
      className="note-markdown-editor-page note-markdown-editor-page--today-hub note-sidecar-group"
    >
      <div className="note-markdown-editor-main-row">
        <div className="note-markdown-editor-fold-rail" aria-hidden="true" />
        <div className="note-markdown-editor-paper note-markdown-editor-paper--today-hub-shell">
          <TodayHubCanvas
            key={`today-hub-${todayHubColumnCount(todayHubSettings)}-${todayHubSettings.start}-${todayHubSettings.columns.join('\0')}-${selectedUri}`}
            vaultRoot={vaultRoot}
            todayNoteUri={selectedUri}
            hubSettings={todayHubSettings}
            inboxContentByUri={inboxContentByUri}
            vaultMarkdownRefs={vaultMarkdownRefs}
            bridgeRef={todayHubBridgeRef}
            wikiNavParentRef={todayHubWikiNavParentRef}
            cellEditorRef={todayHubCellEditorRef}
            onWikiLinkActivate={onWikiLinkActivate}
            onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
            onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
            onEditorError={onEditorError}
            onSaveShortcut={onSaveShortcut}
            prehydrateTodayHubRows={prehydrateTodayHubRows}
            persistTodayHubRow={persistTodayHubRow}
            todayHubCleanRowBlocked={todayHubCleanRowBlocked}
            linkSnippetBlockedDomains={linkSnippetBlockedDomains}
            onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
          />
        </div>
      </div>
    </div>
  );
}

type EditorPaneBodyMainProps = EditorPaneBodyProps & {
  mergeCurrentBody: string;
  scrollTodayHubLayout: boolean;
  frontmatterReadOnly: boolean;
  editorHasFoldedRanges: boolean;
  editorHasFoldableRanges: boolean;
  onFoldedRangesPresentChange: (next: boolean) => void;
  onFoldableRangesPresentChange: (next: boolean) => void;
  backlinksSidecarRef: RefObject<HTMLDivElement | null>;
  todayHubSidecarRef: RefObject<HTMLDivElement | null>;
};

function editorNoteShellScrollClass(scrollTodayHubLayout: boolean): string {
  return scrollTodayHubLayout
    ? 'note-markdown-editor-scroll note-markdown-editor-scroll--today-hub'
    : 'note-markdown-editor-scroll';
}

type EditorPaneFoldBulkButtonProps = {
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  editorHasFoldedRanges: boolean;
  editorHasFoldableRanges: boolean;
  busy: boolean;
};

function EditorPaneFoldBulkButton({
  inboxEditorRef,
  editorHasFoldedRanges,
  editorHasFoldableRanges,
  busy,
}: EditorPaneFoldBulkButtonProps) {
  if (!editorHasFoldedRanges && !editorHasFoldableRanges) {
    return null;
  }
  const expanded = editorHasFoldedRanges;
  const label = expanded ? 'Expand all folds' : 'Collapse all folds';
  return (
    <div className="note-markdown-editor-fold-bulk-anchor">
      <button
        type="button"
        className="note-markdown-editor-fold-bulk-btn app-tooltip-trigger"
        onClick={() => {
          const ed = inboxEditorRef.current;
          if (!ed) {
            return;
          }
          if (expanded) {
            ed.unfoldAllFolds();
          } else {
            ed.collapseAllFolds();
          }
        }}
        disabled={busy}
        aria-label={label}
        data-tooltip={label}
        data-tooltip-placement="inline-end"
      >
        <MaterialIcon
          name={expanded ? 'unfold_more' : 'unfold_less'}
          size={12}
        />
      </button>
    </div>
  );
}

function EditorPaneBodyMain({
  fs,
  mergeView,
  onCloseMergeView,
  onApplyFullBackupFromMerge,
  onApplyMergedBodyFromMerge,
  onKeepMyEditsFromMerge,
  inboxEditorRef,
  inboxEditorShellScrollRef,
  inboxAttachmentHost,
  vaultRoot,
  vaultMarkdownRefs,
  inboxContentByUri,
  composingNewEntry,
  selectedUri,
  editorBody,
  inboxEditorResetNonce,
  onEditorChange,
  onEditorError,
  onWikiLinkActivate,
  onMarkdownRelativeLinkActivate,
  onMarkdownExternalLinkOpen,
  relativeMarkdownLinkHrefIsResolved,
  wikiLinkTargetIsResolved,
  wikiLinkCompletionCandidates,
  onSaveShortcut,
  onCleanNote,
  onDeleteNoteShortcut,
  busy,
  backlinkRows,
  onSelectNote,
  inboxBacklinksDeferNonce,
  showTodayHubCanvas,
  todayHubSettings,
  todayHubBridgeRef,
  todayHubWikiNavParentRef,
  todayHubCellEditorRef,
  prehydrateTodayHubRows,
  persistTodayHubRow,
  todayHubCleanRowBlocked,
  inboxYamlFrontmatterInner,
  applyFrontmatterInnerChange,
  vaultFrontmatterIndex,
  vaultSettings,
  diskConflict: _diskConflict,
  linkSnippetBlockedDomains,
  onMuteLinkSnippetDomain,
  mergeCurrentBody,
  scrollTodayHubLayout,
  frontmatterReadOnly,
  editorHasFoldedRanges,
  editorHasFoldableRanges,
  onFoldedRangesPresentChange,
  onFoldableRangesPresentChange,
  backlinksSidecarRef,
  todayHubSidecarRef,
}: EditorPaneBodyMainProps) {
  return (
    <div className="editor note-markdown-editor-wrap">
        <div
          ref={inboxEditorShellScrollRef}
          className={editorNoteShellScrollClass(scrollTodayHubLayout)}
        >
          <div className="note-markdown-editor-page">
            {selectedUri && !composingNewEntry && mergeView == null ? (
              <div className="note-markdown-editor-frontmatter-host">
                <FrontmatterEditor
                  yamlInner={inboxYamlFrontmatterInner}
                  onChange={applyFrontmatterInnerChange}
                  index={vaultFrontmatterIndex}
                  propertyOverrides={vaultSettings?.frontmatterProperties}
                  readOnly={frontmatterReadOnly}
                  rehydrateKey={`${selectedUri}:${inboxEditorResetNonce}`}
                />
              </div>
            ) : null}
            {mergeView != null ? (
              <BackupMergePanel
                vaultRoot={vaultRoot}
                fs={fs}
                source={
                  mergeView.kind === 'backup'
                    ? ({kind: 'backup', backupUri: mergeView.backupUri} satisfies MergePanelSource)
                    : ({kind: 'disk', diskMarkdown: mergeView.diskMarkdown} satisfies MergePanelSource)
                }
                currentBody={mergeCurrentBody}
                onClose={onCloseMergeView}
                onApplyOther={onApplyFullBackupFromMerge}
                onApplyMergedBody={onApplyMergedBodyFromMerge}
                onKeepLocal={mergeView.kind === 'diskConflict' ? onKeepMyEditsFromMerge : undefined}
                busy={busy}
              />
            ) : null}
            <div
              className="note-markdown-editor-main-row"
              hidden={mergeView != null}
            >
            <div className="note-markdown-editor-fold-rail">
              <EditorPaneFoldBulkButton
                inboxEditorRef={inboxEditorRef}
                editorHasFoldedRanges={editorHasFoldedRanges}
                editorHasFoldableRanges={editorHasFoldableRanges}
                busy={busy}
              />
            </div>
            <div className="note-markdown-editor-paper">
              <NoteMarkdownEditor
                ref={inboxEditorRef}
                attachmentHost={inboxAttachmentHost}
                resolveVaultImagePreviewUrl={resolveVaultImagePreviewUrl}
                vaultRoot={vaultRoot}
                activeNotePath={composingNewEntry ? null : selectedUri}
                initialMarkdown={editorBody}
                sessionKey={inboxEditorResetNonce}
                onMarkdownChange={onEditorChange}
                onEditorError={onEditorError}
                onWikiLinkActivate={onWikiLinkActivate}
                onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
                onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
                relativeMarkdownLinkHrefIsResolved={relativeMarkdownLinkHrefIsResolved}
                wikiLinkTargetIsResolved={wikiLinkTargetIsResolved}
                wikiLinkCompletionCandidates={wikiLinkCompletionCandidates}
                onSaveShortcut={onSaveShortcut}
                onCleanNote={onCleanNote}
                onDeleteNoteShortcut={onDeleteNoteShortcut}
                placeholder={
                  composingNewEntry ? 'First line is title (H1)…' : 'Write markdown…'
                }
                busy={busy}
                onFoldedRangesPresentChange={onFoldedRangesPresentChange}
                onFoldableRangesPresentChange={onFoldableRangesPresentChange}
                linkSnippetBlockedDomains={linkSnippetBlockedDomains}
                onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
              />
              {!composingNewEntry && selectedUri && !showTodayHubCanvas ? (
                <div ref={backlinksSidecarRef} className="note-sidecar-group">
                  <InboxBacklinksSection
                    selectedUri={selectedUri}
                    backlinkRows={backlinkRows}
                    onSelectNote={onSelectNote}
                    deferNonce={inboxBacklinksDeferNonce}
                  />
                </div>
              ) : null}
            </div>
            </div>
          </div>
          <EditorPaneTodayHubBlock
            mergeView={mergeView}
            showTodayHubCanvas={showTodayHubCanvas}
            selectedUri={selectedUri}
            todayHubSettings={todayHubSettings}
            composingNewEntry={composingNewEntry}
            todayHubSidecarRef={todayHubSidecarRef}
            vaultRoot={vaultRoot}
            inboxContentByUri={inboxContentByUri}
            vaultMarkdownRefs={vaultMarkdownRefs}
            todayHubBridgeRef={todayHubBridgeRef}
            todayHubWikiNavParentRef={todayHubWikiNavParentRef}
            todayHubCellEditorRef={todayHubCellEditorRef}
            onWikiLinkActivate={onWikiLinkActivate}
            onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
            onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
            onEditorError={onEditorError}
            onSaveShortcut={onSaveShortcut}
            prehydrateTodayHubRows={prehydrateTodayHubRows}
            persistTodayHubRow={persistTodayHubRow}
            todayHubCleanRowBlocked={todayHubCleanRowBlocked}
            linkSnippetBlockedDomains={linkSnippetBlockedDomains}
            onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
          />
        </div>
    </div>
  );
}

function InboxBacklinksSection({
  selectedUri,
  backlinkRows,
  onSelectNote,
  deferNonce,
}: InboxBacklinksSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const lastAppliedDeferNonceRef = useRef(deferNonce);

  useLayoutEffect(() => {
    if (lastAppliedDeferNonceRef.current === deferNonce) {
      return;
    }
    lastAppliedDeferNonceRef.current = deferNonce;
    const section = sectionRef.current;
    if (section) {
      section.setAttribute('aria-hidden', 'true');
      section.classList.add('inbox-backlinks--defer-first-paint');
    }
    const raf = requestAnimationFrame(() => {
      if (section) {
        section.setAttribute('aria-hidden', 'false');
        section.classList.remove('inbox-backlinks--defer-first-paint');
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [deferNonce, selectedUri]);

  return (
    <section
      ref={sectionRef}
      aria-hidden="false"
      aria-label="Backlinks"
      className="inbox-backlinks"
    >
      <div className="inbox-backlinks__header">Linked from</div>
      {backlinkRows.length === 0 ? (
        <p className="muted inbox-backlinks__empty">No incoming links.</p>
      ) : (
        <ul className="inbox-backlinks__list">
          {backlinkRows.map(row => (
            <li key={row.uri}>
              <button
                type="button"
                className="inbox-backlinks__row"
                onClick={() => onSelectNote(row.uri)}
              >
                <span className="inbox-backlinks__title">{row.title}</span>
                <span className="inbox-backlinks__filename">{row.fileName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditorPaneBody({
  fs,
  mergeView,
  onCloseMergeView,
  onApplyFullBackupFromMerge,
  onApplyMergedBodyFromMerge,
  onKeepMyEditsFromMerge,
  inboxEditorRef,
  inboxEditorShellScrollRef,
  inboxAttachmentHost,
  vaultRoot,
  vaultMarkdownRefs,
  inboxContentByUri,
  composingNewEntry,
  selectedUri,
  editorBody,
  inboxEditorResetNonce,
  onEditorChange,
  onEditorError,
  onWikiLinkActivate,
  onMarkdownRelativeLinkActivate,
  onMarkdownExternalLinkOpen,
  relativeMarkdownLinkHrefIsResolved,
  wikiLinkTargetIsResolved,
  wikiLinkCompletionCandidates,
  onSaveShortcut,
  onCleanNote,
  onDeleteNoteShortcut,
  busy,
  backlinkRows,
  onSelectNote,
  inboxBacklinksDeferNonce,
  showTodayHubCanvas,
  todayHubSettings,
  todayHubBridgeRef,
  todayHubWikiNavParentRef,
  todayHubCellEditorRef,
  prehydrateTodayHubRows,
  persistTodayHubRow,
  todayHubCleanRowBlocked,
  inboxYamlFrontmatterInner,
  applyFrontmatterInnerChange,
  vaultFrontmatterIndex,
  vaultSettings,
  diskConflict,
  linkSnippetBlockedDomains,
  onMuteLinkSnippetDomain,
}: EditorPaneBodyProps) {
  const [editorHasFoldedRanges, setEditorHasFoldedRanges] = useState(false);
  const [editorHasFoldableRanges, setEditorHasFoldableRanges] = useState(false);
  const editorHasFoldedRangesRef = useRef(editorHasFoldedRanges);
  const editorHasFoldableRangesRef = useRef(editorHasFoldableRanges);
  const backlinksSidecarRef = useRef<HTMLDivElement | null>(null);
  const todayHubSidecarRef = useRef<HTMLDivElement | null>(null);
  const isInitialSidecarDeferRef = useRef(true);

  useLayoutEffect(() => {
    editorHasFoldedRangesRef.current = editorHasFoldedRanges;
    editorHasFoldableRangesRef.current = editorHasFoldableRanges;
  }, [editorHasFoldedRanges, editorHasFoldableRanges]);

  useLayoutEffect(() => {
    if (isInitialSidecarDeferRef.current) {
      isInitialSidecarDeferRef.current = false;
      return;
    }
    const els: HTMLElement[] = [];
    const b = backlinksSidecarRef.current;
    const t = todayHubSidecarRef.current;
    if (b) {
      els.push(b);
    }
    if (t) {
      els.push(t);
    }
    for (const el of els) {
      el.classList.add('note-sidecar-group--deferred');
    }
    const id = window.requestAnimationFrame(() => {
      for (const el of els) {
        el.classList.remove('note-sidecar-group--deferred');
      }
    });
    return () => {
      window.cancelAnimationFrame(id);
      for (const el of els) {
        el.classList.remove('note-sidecar-group--deferred');
      }
    };
  }, [selectedUri, mergeView]);

  const onFoldedRangesPresentChange = useCallback((next: boolean) => {
    setEditorHasFoldedRanges(next);
  }, []);

  const onFoldableRangesPresentChange = useCallback((next: boolean) => {
    setEditorHasFoldableRanges(next);
  }, []);

  const {mergeCurrentBody, scrollTodayHubLayout, frontmatterReadOnly} =
    useEditorPaneBodyDerived(
      mergeView,
      inboxContentByUri,
      selectedUri,
      editorBody,
      showTodayHubCanvas,
      todayHubSettings,
      composingNewEntry,
      busy,
      diskConflict,
    );

  return (
    <EditorPaneBodyMain
      fs={fs}
      mergeView={mergeView}
      onCloseMergeView={onCloseMergeView}
      onApplyFullBackupFromMerge={onApplyFullBackupFromMerge}
      onApplyMergedBodyFromMerge={onApplyMergedBodyFromMerge}
      onKeepMyEditsFromMerge={onKeepMyEditsFromMerge}
      inboxEditorRef={inboxEditorRef}
      inboxEditorShellScrollRef={inboxEditorShellScrollRef}
      inboxAttachmentHost={inboxAttachmentHost}
      vaultRoot={vaultRoot}
      vaultMarkdownRefs={vaultMarkdownRefs}
      inboxContentByUri={inboxContentByUri}
      composingNewEntry={composingNewEntry}
      selectedUri={selectedUri}
      editorBody={editorBody}
      inboxEditorResetNonce={inboxEditorResetNonce}
      onEditorChange={onEditorChange}
      onEditorError={onEditorError}
      onWikiLinkActivate={onWikiLinkActivate}
      onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
      onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
      relativeMarkdownLinkHrefIsResolved={relativeMarkdownLinkHrefIsResolved}
      wikiLinkTargetIsResolved={wikiLinkTargetIsResolved}
      wikiLinkCompletionCandidates={wikiLinkCompletionCandidates}
      onSaveShortcut={onSaveShortcut}
      onCleanNote={onCleanNote}
      onDeleteNoteShortcut={onDeleteNoteShortcut}
      busy={busy}
      backlinkRows={backlinkRows}
      onSelectNote={onSelectNote}
      inboxBacklinksDeferNonce={inboxBacklinksDeferNonce}
      showTodayHubCanvas={showTodayHubCanvas}
      todayHubSettings={todayHubSettings}
      todayHubBridgeRef={todayHubBridgeRef}
      todayHubWikiNavParentRef={todayHubWikiNavParentRef}
      todayHubCellEditorRef={todayHubCellEditorRef}
      prehydrateTodayHubRows={prehydrateTodayHubRows}
      persistTodayHubRow={persistTodayHubRow}
      todayHubCleanRowBlocked={todayHubCleanRowBlocked}
      inboxYamlFrontmatterInner={inboxYamlFrontmatterInner}
      applyFrontmatterInnerChange={applyFrontmatterInnerChange}
      vaultFrontmatterIndex={vaultFrontmatterIndex}
      vaultSettings={vaultSettings}
      diskConflict={diskConflict}
      linkSnippetBlockedDomains={linkSnippetBlockedDomains}
      onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
      mergeCurrentBody={mergeCurrentBody}
      scrollTodayHubLayout={scrollTodayHubLayout}
      frontmatterReadOnly={frontmatterReadOnly}
      editorHasFoldedRanges={editorHasFoldedRanges}
      editorHasFoldableRanges={editorHasFoldableRanges}
      onFoldedRangesPresentChange={onFoldedRangesPresentChange}
      onFoldableRangesPresentChange={onFoldableRangesPresentChange}
      backlinksSidecarRef={backlinksSidecarRef}
      todayHubSidecarRef={todayHubSidecarRef}
    />
  );
}

export function VaultTab({
  environment,
  frontmatterController,
  editorController,
  layoutController,
  playbackController,
  linkController,
  treeController,
  mergeController,
  tabsController,
  notificationsController,
  todayHubController,
}: VaultTabProps) {
  const {
    vaultRoot,
    vaultSettings,
    fs,
    fsRefreshNonce,
    vaultMarkdownRefs,
  } = environment;
  const {
    inboxYamlFrontmatterInner,
    applyFrontmatterInnerChange,
    diskConflict,
  } = frontmatterController;
  const {
    vaultPaneVisible,
    onToggleVault,
    episodesPaneVisible,
    onToggleEpisodes,
    inboxPaneVisible,
    onToggleInboxPane,
    onOpenInboxPane,
    onCloseInboxPane,
    vaultWidthPx,
    episodesWidthPx,
    onVaultWidthPxChanged,
    onEpisodesWidthPxChanged,
    stackTopHeightPx,
    onStackTopHeightPxChanged,
    notificationsWidthPx,
    onNotificationsWidthPxChanged,
    titleBarEditorTabsHost = null,
  } = layoutController;
  const {
    inboxEditorRef,
    inboxEditorShellScrollRef,
    inboxEditorShellScrollDirectiveRef,
    inboxContentByUri,
    backlinkUris,
    selectedUri,
    onSelectNote,
    onSelectNoteInNewActiveTab,
    onAddEntry,
    composingNewEntry,
    onCancelNewEntry,
    onCreateNewEntry,
    editorBody,
    onEditorChange,
    inboxEditorResetNonce,
    onEditorError,
    onSaveShortcut,
    onCleanNote,
    busy,
    inboxBacklinksDeferNonce,
  } = editorController;
  const {
    onWikiLinkActivate,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
    linkSnippetBlockedDomains,
    onMuteLinkSnippetDomain,
  } = linkController;
  const {
    editorHistoryCanGoBack,
    editorHistoryCanGoForward,
    onEditorHistoryGoBack,
    onEditorHistoryGoForward,
    editorWorkspaceTabs,
    activeEditorTabId,
    onActivateOpenTab,
    onCloseEditorTab,
    onReorderEditorWorkspaceTabs,
    onCloseOtherEditorTabs,
  } = tabsController;
  const {
    notificationsPanelVisible,
    onToggleNotificationsPanel,
    notificationItems,
  } = notificationsController;
  const {
    notes,
    onDeleteNote,
    onRenameNote,
    onDeleteFolder,
    onRenameFolder,
    onMoveVaultTreeItem,
    onBulkMoveVaultTreeItems,
    onBulkDeleteVaultTreeItems,
    vaultTreeSelectionClearNonce,
  } = treeController;
  const {
    wikiLinkAmbiguityRenamePrompt,
    onConfirmWikiLinkAmbiguityRename,
    onCancelWikiLinkAmbiguityRename,
    mergeView,
    onCloseMergeView,
    onApplyFullBackupFromMerge,
    onApplyMergedBodyFromMerge,
    onKeepMyEditsFromMerge,
  } = mergeController;
  const {
    playbackTransport,
    toolbarNowPlaying,
    episodesPane,
  } = playbackController;
  const {
    showTodayHubCanvas,
    todayHubSettings,
    todayHubBridgeRef,
    todayHubWikiNavParentRef,
    todayHubCellEditorRef,
    prehydrateTodayHubRows,
    persistTodayHubRow,
    todayHubCleanRowBlocked,
  } = todayHubController;
  const [revealTreeNonce, setRevealTreeNonce] = useState(0);
  const normalizedVaultRootForTree = useMemo(
    () => trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/')),
    [vaultRoot],
  );
  const inboxDirectoryUriForTree = useMemo(
    () =>
      trimTrailingSlashes(getInboxDirectoryUri(normalizedVaultRootForTree).replace(/\\/g, '/')),
    [normalizedVaultRootForTree],
  );
  const inboxHasItems = useMemo(
    () => countInboxVaultMarkdownRefs(vaultRoot, vaultMarkdownRefs) > 0,
    [vaultRoot, vaultMarkdownRefs],
  );
  const prevInboxHadItemsRef = useRef(false);
  useEffect(() => {
    const wasNonEmpty = prevInboxHadItemsRef.current;
    prevInboxHadItemsRef.current = inboxHasItems;
    if (wasNonEmpty && !inboxHasItems && inboxPaneVisible) {
      fireInboxClearedConfetti();
      const raf = requestAnimationFrame(() => {
        onCloseInboxPane();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [inboxHasItems, inboxPaneVisible, onCloseInboxPane]);
  const prevVaultRootForInboxTrackingRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevVaultRootForInboxTrackingRef.current;
    prevVaultRootForInboxTrackingRef.current = vaultRoot;
    if (prev != null && prev !== vaultRoot) {
      prevInboxHadItemsRef.current = false;
    }
  }, [vaultRoot]);
  const notificationsHasItems = notificationItems.length > 0;
  const revealActiveNoteDisabled =
    composingNewEntry
    || selectedUri == null
    || (
      selectedUri !== normalizedVaultRootForTree
      && !selectedUri.startsWith(`${normalizedVaultRootForTree}/`)
    );
  const revealInInboxTreeDisabled =
    composingNewEntry
    || selectedUri == null
    || (
      selectedUri !== inboxDirectoryUriForTree
      && !selectedUri.startsWith(`${inboxDirectoryUriForTree}/`)
    );
  const bumpRevealActiveNoteInTree = useCallback(() => {
    if (
      selectedUri != null
      && (selectedUri === inboxDirectoryUriForTree
        || selectedUri.startsWith(`${inboxDirectoryUriForTree}/`))
    ) {
      onOpenInboxPane();
    }
    setRevealTreeNonce(n => n + 1);
  }, [selectedUri, inboxDirectoryUriForTree, onOpenInboxPane]);
  const inboxAttachmentHost = useMemo(() => createNoteInboxAttachmentHost(), []);
  const vaultFrontmatterIndex = useVaultFrontmatterIndex({
    vaultRoot,
    overrides: vaultSettings?.frontmatterProperties,
  });
  const [confirmDeleteUri, setConfirmDeleteUri] = useState<string | null>(null);
  const [confirmDeleteFolderUri, setConfirmDeleteFolderUri] = useState<string | null>(
    null,
  );
  const [confirmBulkDeleteItems, setConfirmBulkDeleteItems] = useState<
    VaultTreeBulkItem[] | null
  >(null);
  const [renameTargetUri, setRenameTargetUri] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameFolderUri, setRenameFolderUri] = useState<string | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const confirmDeleteNoteActionRef = useRef<HTMLButtonElement | null>(null);
  const confirmDeleteFolderActionRef = useRef<HTMLButtonElement | null>(null);
  const confirmBulkDeleteActionRef = useRef<HTMLButtonElement | null>(null);
  const vaultMarkdownRefsRef = useRef(vaultMarkdownRefs);
  const onMoveVaultTreeItemRef = useRef(onMoveVaultTreeItem);
  const onBulkMoveVaultTreeItemsRef = useRef(onBulkMoveVaultTreeItems);

  useLayoutEffect(() => {
    vaultMarkdownRefsRef.current = vaultMarkdownRefs;
    onMoveVaultTreeItemRef.current = onMoveVaultTreeItem;
    onBulkMoveVaultTreeItemsRef.current = onBulkMoveVaultTreeItems;
  }, [
    vaultMarkdownRefs,
    onMoveVaultTreeItem,
    onBulkMoveVaultTreeItems,
  ]);

  const onDeleteNoteShortcut = useCallback(() => {
    if (busy || composingNewEntry || selectedUri == null) {
      return;
    }
    setConfirmDeleteUri(selectedUri);
  }, [busy, composingNewEntry, selectedUri]);

  const onDeleteNoteShortcutRef = useRef(onDeleteNoteShortcut);
  useLayoutEffect(() => {
    onDeleteNoteShortcutRef.current = onDeleteNoteShortcut;
  }, [onDeleteNoteShortcut]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        !shouldHandleDeleteNoteGlobalShortcut(e, {
          activeElement: document.activeElement,
          eventTarget: e.target,
        })
      ) {
        return;
      }
      onDeleteNoteShortcutRef.current();
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, false);
    return () => {
      window.removeEventListener('keydown', onKeyDown, false);
    };
  }, []);

  const renameFolderInputRef = useRef<HTMLInputElement | null>(null);

  const openRenameDialog = useCallback((uri: string) => {
    const draft = renameDraftStemForMarkdownUri(uri, vaultMarkdownRefsRef.current);
    if (draft === null) {
      return;
    }
    setRenameTargetUri(uri);
    setRenameDraft(draft);
  }, []);

  const submitRename = () => {
    const uri = renameTargetUri;
    if (!uri || busy) {
      return;
    }
    void onRenameNote(uri, renameDraft);
    setRenameTargetUri(null);
  };

  const onDeleteNoteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfirmDeleteUri(null);
    }
  }, []);

  const onConfirmDeleteNote = useCallback(() => {
    const uri = confirmDeleteUri;
    if (uri) {
      void onDeleteNote(uri);
    }
  }, [confirmDeleteUri, onDeleteNote]);

  const openRenameFolderDialog = useCallback((uri: string) => {
    const tail = uri.split(/[/\\]/).filter(Boolean).pop();
    if (!tail) {
      return;
    }
    setRenameFolderUri(uri);
    setRenameFolderDraft(tail);
  }, []);

  const openTreeDeleteNoteDialog = useCallback((uri: string) => {
    setConfirmDeleteUri(uri);
  }, []);

  const openTreeDeleteFolderDialog = useCallback((uri: string) => {
    setConfirmDeleteFolderUri(uri);
  }, []);

  const openBulkDeleteDialog = useCallback((items: VaultTreeBulkItem[]) => {
    setConfirmBulkDeleteItems(items);
  }, []);

  const onDeleteFolderDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfirmDeleteFolderUri(null);
    }
  }, []);

  const onConfirmDeleteFolder = useCallback(() => {
    const uri = confirmDeleteFolderUri;
    if (uri) {
      void onDeleteFolder(uri);
    }
  }, [confirmDeleteFolderUri, onDeleteFolder]);

  const onBulkDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setConfirmBulkDeleteItems(null);
    }
  }, []);

  const onConfirmBulkDelete = useCallback(() => {
    const items = confirmBulkDeleteItems;
    setConfirmBulkDeleteItems(null);
    if (items) {
      void onBulkDeleteVaultTreeItems(items);
    }
  }, [confirmBulkDeleteItems, onBulkDeleteVaultTreeItems]);

  const onWikiLinkAmbiguityRenameDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onCancelWikiLinkAmbiguityRename();
      }
    },
    [onCancelWikiLinkAmbiguityRename],
  );

  const onRenameNoteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameTargetUri(null);
    }
  }, []);

  const onRenameDraftChange = useCallback((next: string) => {
    setRenameDraft(next);
  }, []);

  const onRenameFolderDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRenameFolderUri(null);
    }
  }, []);

  const onRenameFolderDraftChange = useCallback((next: string) => {
    setRenameFolderDraft(next);
  }, []);

  const moveVaultTreeItemStable = useCallback(
    (
      sourceUri: string,
      sourceKind: 'folder' | 'article',
      targetDirectoryUri: string,
    ) => onMoveVaultTreeItemRef.current(sourceUri, sourceKind, targetDirectoryUri),
    [],
  );

  const bulkMoveVaultTreeItemsStable = useCallback(
    (items: VaultTreeBulkItem[], targetDirectoryUri: string) =>
      onBulkMoveVaultTreeItemsRef.current(items, targetDirectoryUri),
    [],
  );

  const submitFolderRename = () => {
    const uri = renameFolderUri;
    if (!uri || busy) {
      return;
    }
    void onRenameFolder(uri, renameFolderDraft);
    setRenameFolderUri(null);
  };

  useEffect(() => {
    if (!renameTargetUri) {
      return;
    }
    const id = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [renameTargetUri]);

  useEffect(() => {
    if (!renameFolderUri) {
      return;
    }
    const id = window.setTimeout(() => {
      renameFolderInputRef.current?.focus();
      renameFolderInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [renameFolderUri]);

  const {
    wikiLinkTargetIsResolved,
    relativeMarkdownLinkHrefIsResolved,
    wikiLinkCompletionCandidates,
  } = useMemo(
    () =>
      buildVaultTabLinkDerivedData({
        vaultRoot,
        vaultMarkdownRefs,
        composingNewEntry,
        selectedUri,
        showTodayHubCanvas,
      }),
    [
      vaultRoot,
      vaultMarkdownRefs,
      composingNewEntry,
      selectedUri,
      showTodayHubCanvas,
    ],
  );

  const editorPaneTitle = useMemo(() => {
    if (composingNewEntry) {
      return 'New entry';
    }
    if (!selectedUri) {
      return 'Editor';
    }
    const row = notes.find(n => n.uri === selectedUri);
    if (row) {
      return row.name;
    }
    const tail = selectedUri.split(/[/\\]/).pop()?.trim();
    return tail || 'Editor';
  }, [composingNewEntry, notes, selectedUri]);

  const backlinkRows = useMemo(
    () =>
      buildVaultTabBacklinkRows({
        backlinkUris,
        vaultMarkdownRefs,
        composingNewEntry,
        selectedUri,
        editorBody,
        inboxContentByUri,
      }),
    [
      backlinkUris,
      vaultMarkdownRefs,
      composingNewEntry,
      selectedUri,
      editorBody,
      inboxContentByUri,
    ],
  );

  const editorOpen = composingNewEntry || Boolean(selectedUri);

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
    composingNewEntry,
    inboxEditorShellScrollDirectiveRef,
    inboxEditorShellScrollRef,
  ]);

  const titleBarTabsPortal =
    titleBarEditorTabsHost != null && !composingNewEntry
      ? createPortal(
          <EditorPaneOpenNoteTabs
            notes={notes}
            workspaceTabs={editorWorkspaceTabs}
            activeTabId={activeEditorTabId}
            busy={busy}
            onActivateTab={onActivateOpenTab}
            onCloseTab={onCloseEditorTab}
            onRenameNote={openRenameDialog}
            onCloseOtherTabs={onCloseOtherEditorTabs}
            inTitleBar
            onReorderTabs={onReorderEditorWorkspaceTabs}
          />,
          titleBarEditorTabsHost,
        )
      : null;
  const shellEndColumnVisible = notificationsPanelVisible || inboxPaneVisible;
  const shellEndColumnContent = shellEndColumnVisible ? (
    <VaultTabSideColumn
      environment={environment}
      layoutController={layoutController}
      editorController={editorController}
      treeController={treeController}
      notificationsController={notificationsController}
      revealTreeNonce={revealTreeNonce}
      onRevealActiveNoteInTree={bumpRevealActiveNoteInTree}
      revealInInboxTreeDisabled={revealInInboxTreeDisabled}
      onRenameMarkdownRequest={openRenameDialog}
      onDeleteMarkdownRequest={openTreeDeleteNoteDialog}
      onRenameFolderRequest={openRenameFolderDialog}
      onDeleteFolderRequest={openTreeDeleteFolderDialog}
      onBulkDeleteRequest={openBulkDeleteDialog}
      onMoveVaultTreeItem={moveVaultTreeItemStable}
      onBulkMoveVaultTreeItems={bulkMoveVaultTreeItemsStable}
    />
  ) : null;
  return (
    <Fragment>
      {titleBarTabsPortal}
      <div className="inbox-root" data-app-surface="capture">
      <VaultTabDialogs
        busy={busy}
        vaultRoot={vaultRoot}
        confirmDeleteUri={confirmDeleteUri}
        onDeleteNoteDialogOpenChange={onDeleteNoteDialogOpenChange}
        confirmDeleteNoteActionRef={confirmDeleteNoteActionRef}
        onConfirmDeleteNote={onConfirmDeleteNote}
        confirmDeleteFolderUri={confirmDeleteFolderUri}
        onDeleteFolderDialogOpenChange={onDeleteFolderDialogOpenChange}
        confirmDeleteFolderActionRef={confirmDeleteFolderActionRef}
        onConfirmDeleteFolder={onConfirmDeleteFolder}
        confirmBulkDeleteItems={confirmBulkDeleteItems}
        onBulkDeleteDialogOpenChange={onBulkDeleteDialogOpenChange}
        confirmBulkDeleteActionRef={confirmBulkDeleteActionRef}
        onConfirmBulkDelete={onConfirmBulkDelete}
        wikiLinkAmbiguityRenamePrompt={wikiLinkAmbiguityRenamePrompt}
        onWikiLinkAmbiguityRenameDialogOpenChange={
          onWikiLinkAmbiguityRenameDialogOpenChange
        }
        onConfirmWikiLinkAmbiguityRename={onConfirmWikiLinkAmbiguityRename}
        renameTargetUri={renameTargetUri}
        onRenameNoteDialogOpenChange={onRenameNoteDialogOpenChange}
        renameInputRef={renameInputRef}
        renameDraft={renameDraft}
        onRenameDraftChange={onRenameDraftChange}
        onSubmitRename={submitRename}
        renameFolderUri={renameFolderUri}
        onRenameFolderDialogOpenChange={onRenameFolderDialogOpenChange}
        renameFolderInputRef={renameFolderInputRef}
        renameFolderDraft={renameFolderDraft}
        onRenameFolderDraftChange={onRenameFolderDraftChange}
        onSubmitFolderRename={submitFolderRename}
      />

      <div className="main-workspace-canvas">
      <EditorWorkspaceToolbar
        vaultPaneVisible={vaultPaneVisible}
        onToggleVault={onToggleVault}
        episodesPaneVisible={episodesPaneVisible}
        onToggleEpisodes={onToggleEpisodes}
        inboxPaneVisible={inboxPaneVisible}
        onToggleInboxPane={onToggleInboxPane}
        busy={busy}
        editorHistoryCanGoBack={editorHistoryCanGoBack}
        editorHistoryCanGoForward={editorHistoryCanGoForward}
        onEditorHistoryGoBack={onEditorHistoryGoBack}
        onEditorHistoryGoForward={onEditorHistoryGoForward}
        composingNewEntry={composingNewEntry}
        editorPaneTitle={editorPaneTitle}
        onCancelNewEntry={onCancelNewEntry}
        notificationsPanelVisible={notificationsPanelVisible}
        onToggleNotificationsPanel={onToggleNotificationsPanel}
        inboxHasItems={inboxHasItems}
        notificationsHasItems={notificationsHasItems}
        playbackTransport={playbackTransport}
        nowPlaying={toolbarNowPlaying ?? null}
        onCleanNote={onCleanNote}
      />
      <DesktopHorizontalSplitEnd
        endVisible={shellEndColumnVisible}
        endWidthPx={notificationsWidthPx}
        minEndPx={NOTIFICATIONS_PANEL.minPx}
        maxEndPx={NOTIFICATIONS_PANEL.maxPx}
        minMainPx={MIN_RESIZABLE_PANE_PX}
        onEndWidthPxChanged={onNotificationsWidthPxChanged}
        main={
          <MainWorkspaceSplit
            vaultVisible={vaultPaneVisible}
            episodesVisible={episodesPaneVisible}
            vaultWidthPx={vaultWidthPx}
            episodesWidthPx={episodesWidthPx}
            onVaultWidthPxChanged={onVaultWidthPxChanged}
            onEpisodesWidthPxChanged={onEpisodesWidthPxChanged}
            stackTopHeightPx={stackTopHeightPx}
            onStackTopHeightPxChanged={onStackTopHeightPxChanged}
            vaultPane={
              <VaultTreePane
                vaultRoot={vaultRoot}
                fs={fs}
                fsRefreshNonce={fsRefreshNonce}
                vaultTreeSelectionClearNonce={vaultTreeSelectionClearNonce}
                editorActiveMarkdownUri={composingNewEntry ? null : selectedUri}
                revealActiveNoteNonce={revealTreeNonce}
                onRevealActiveNoteInTree={bumpRevealActiveNoteInTree}
                revealActiveNoteDisabled={revealActiveNoteDisabled}
                busy={busy}
                onAddEntry={onAddEntry}
                onOpenMarkdownNote={onSelectNote}
                onOpenMarkdownNoteInNewActiveTab={onSelectNoteInNewActiveTab}
                onRenameMarkdownRequest={openRenameDialog}
                onDeleteMarkdownRequest={openTreeDeleteNoteDialog}
                onRenameFolderRequest={openRenameFolderDialog}
                onDeleteFolderRequest={openTreeDeleteFolderDialog}
                onBulkDeleteRequest={openBulkDeleteDialog}
                onMoveVaultTreeItem={moveVaultTreeItemStable}
                onBulkMoveVaultTreeItems={bulkMoveVaultTreeItemsStable}
              />
            }
            episodesPane={episodesPane}
            editorPane={
              <div className="panel-surface">
                {editorOpen ? (
                  <>
                    <EditorPaneBody
                      fs={fs}
                      mergeView={mergeView}
                      onCloseMergeView={onCloseMergeView}
                      onApplyFullBackupFromMerge={onApplyFullBackupFromMerge}
                      onApplyMergedBodyFromMerge={onApplyMergedBodyFromMerge}
                      onKeepMyEditsFromMerge={onKeepMyEditsFromMerge}
                      inboxEditorRef={inboxEditorRef}
                      inboxEditorShellScrollRef={inboxEditorShellScrollRef}
                      inboxAttachmentHost={inboxAttachmentHost}
                      vaultRoot={vaultRoot}
                      vaultMarkdownRefs={vaultMarkdownRefs}
                      inboxContentByUri={inboxContentByUri}
                      composingNewEntry={composingNewEntry}
                      selectedUri={selectedUri}
                      inboxYamlFrontmatterInner={inboxYamlFrontmatterInner}
                      applyFrontmatterInnerChange={applyFrontmatterInnerChange}
                      vaultFrontmatterIndex={vaultFrontmatterIndex}
                      vaultSettings={vaultSettings}
                      diskConflict={diskConflict}
                      editorBody={editorBody}
                      inboxEditorResetNonce={inboxEditorResetNonce}
                      onEditorChange={onEditorChange}
                      onEditorError={onEditorError}
                      onWikiLinkActivate={onWikiLinkActivate}
                      onMarkdownRelativeLinkActivate={onMarkdownRelativeLinkActivate}
                      onMarkdownExternalLinkOpen={onMarkdownExternalLinkOpen}
                      relativeMarkdownLinkHrefIsResolved={
                        relativeMarkdownLinkHrefIsResolved
                      }
                      wikiLinkTargetIsResolved={wikiLinkTargetIsResolved}
                      wikiLinkCompletionCandidates={wikiLinkCompletionCandidates}
                      onSaveShortcut={onSaveShortcut}
                      onCleanNote={onCleanNote}
                      onDeleteNoteShortcut={onDeleteNoteShortcut}
                      busy={busy}
                      backlinkRows={backlinkRows}
                      onSelectNote={onSelectNote}
                      inboxBacklinksDeferNonce={inboxBacklinksDeferNonce}
                      showTodayHubCanvas={showTodayHubCanvas}
                      todayHubSettings={todayHubSettings}
                      todayHubBridgeRef={todayHubBridgeRef}
                      todayHubWikiNavParentRef={todayHubWikiNavParentRef}
                      todayHubCellEditorRef={todayHubCellEditorRef}
                      prehydrateTodayHubRows={prehydrateTodayHubRows}
                      persistTodayHubRow={persistTodayHubRow}
                      todayHubCleanRowBlocked={todayHubCleanRowBlocked}
                      linkSnippetBlockedDomains={linkSnippetBlockedDomains}
                      onMuteLinkSnippetDomain={onMuteLinkSnippetDomain}
                    />
                    {composingNewEntry ? (
                      <div className="pane-footer">
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void onCreateNewEntry()}
                          disabled={busy}
                        >
                          Create note
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="muted empty-hint">
                    Select a note from the vault or Inbox tree, or use Add entry.
                  </p>
                )}
              </div>
            }
          />
        }
        end={shellEndColumnContent}
      />
      </div>
    </div>
    </Fragment>
  );
}
