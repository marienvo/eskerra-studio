import type {MutableRefObject, RefObject} from 'react';
import {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react';

import type {EskerraSettings, VaultFilesystem, VaultMarkdownRef} from '@eskerra/core';

import {createNoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {resolveVaultImagePreviewUrl} from '../../lib/resolveVaultImagePreviewUrl';
import {todayHubColumnCount, type TodayHubSettings, type TodayHubWorkspaceBridge} from '../../lib/todayHub';
import {FrontmatterEditor, type VaultFrontmatterIndexApi} from '../../editor/frontmatterEditor/FrontmatterEditor';
import {NoteMarkdownEditor, type NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import {BackupMergePanel, type MergePanelSource} from '../BackupMergePanel';
import {MaterialIcon} from '../MaterialIcon';
import {TodayHubCanvas} from '../TodayHubCanvas';
import {buildVaultTabEditorPaneDerived} from '../vaultTabEditorPaneDerived';
import type {VaultTabWikiLinkCompletionCandidates} from '../vaultTabLinkDerived';
import type {VaultTabEditorController, VaultTabLinkController} from '../vaultTabTypes';

type DiskConflictPayload = {uri: string};

type VaultTabEditorPaneProps = {
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
  persistTodayHubRow: (rowUri: string, mergedMarkdown: string, columnCount: number) => Promise<boolean>;
  todayHubCleanRowBlocked?: (rowUri: string) => boolean;
  linkSnippetBlockedDomains?: VaultTabLinkController['linkSnippetBlockedDomains'];
  onMuteLinkSnippetDomain?: VaultTabLinkController['onMuteLinkSnippetDomain'];
};

function useEditorPaneBodyDerived(
  mergeView: VaultTabEditorPaneProps['mergeView'],
  inboxContentByUri: VaultTabEditorPaneProps['inboxContentByUri'],
  selectedUri: VaultTabEditorPaneProps['selectedUri'],
  editorBody: string,
  showTodayHubCanvas: boolean,
  todayHubSettings: TodayHubSettings | null,
  composingNewEntry: boolean,
  busy: boolean,
  diskConflict: VaultTabEditorPaneProps['diskConflict'],
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

function editorNoteShellScrollClass(scrollTodayHubLayout: boolean): string {
  return scrollTodayHubLayout
    ? 'note-markdown-editor-scroll note-markdown-editor-scroll--today-hub'
    : 'note-markdown-editor-scroll';
}

function InboxBacklinksSection({
  selectedUri,
  backlinkRows,
  onSelectNote,
  deferNonce,
}: {
  selectedUri: string;
  backlinkRows: readonly {uri: string; fileName: string; title: string}[];
  onSelectNote: (uri: string) => void;
  deferNonce: number;
}) {
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
}: {
  mergeView: VaultTabEditorPaneProps['mergeView'];
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
  onWikiLinkActivate: VaultTabEditorPaneProps['onWikiLinkActivate'];
  onMarkdownRelativeLinkActivate: VaultTabEditorPaneProps['onMarkdownRelativeLinkActivate'];
  onMarkdownExternalLinkOpen: VaultTabEditorPaneProps['onMarkdownExternalLinkOpen'];
  onEditorError: VaultTabEditorPaneProps['onEditorError'];
  onSaveShortcut: VaultTabEditorPaneProps['onSaveShortcut'];
  prehydrateTodayHubRows: VaultTabEditorPaneProps['prehydrateTodayHubRows'];
  persistTodayHubRow: VaultTabEditorPaneProps['persistTodayHubRow'];
  todayHubCleanRowBlocked: VaultTabEditorPaneProps['todayHubCleanRowBlocked'];
  linkSnippetBlockedDomains: VaultTabEditorPaneProps['linkSnippetBlockedDomains'];
  onMuteLinkSnippetDomain: VaultTabEditorPaneProps['onMuteLinkSnippetDomain'];
}) {
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

function EditorPaneFoldBulkButton({
  inboxEditorRef,
  editorHasFoldedRanges,
  editorHasFoldableRanges,
  busy,
}: {
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  editorHasFoldedRanges: boolean;
  editorHasFoldableRanges: boolean;
  busy: boolean;
}) {
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

export function VaultTabEditorPane({
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
}: VaultTabEditorPaneProps) {
  const [editorHasFoldedRanges, setEditorHasFoldedRanges] = useState(false);
  const [editorHasFoldableRanges, setEditorHasFoldableRanges] = useState(false);
  const backlinksSidecarRef = useRef<HTMLDivElement | null>(null);
  const todayHubSidecarRef = useRef<HTMLDivElement | null>(null);
  const isInitialSidecarDeferRef = useRef(true);

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
