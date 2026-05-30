import {Compartment} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import type {Extension} from '@codemirror/state';
import {useCallback, useEffect, useLayoutEffect, useRef, type RefObject} from 'react';

import type {InboxWikiLinkCompletionCandidate} from '@eskerra/core';

import type {NoteInboxAttachmentHost} from '../../lib/noteInboxAttachmentHost';
import {
  linkRichBlockedDomainsBumpEffect,
  type LinkRichPreviewRefs,
} from './linkRichPreviewCodemirror';
import {vaultImagePreviewContextBumpEffect} from './vaultImagePreviewCodemirror';
import {dispatchEskerraTableNestedCellEditors} from './eskerraTableV1/eskerraTableNestedCellEditors';
import type {TableCellContextMenuOpen} from './noteMarkdownCellEditor';
import type {NoteMarkdownEditorProps} from './noteMarkdownEditorTypes';
import type {VaultImagePreviewUrlResolver} from './vaultImagePreviewTypes';

export type NoteMarkdownEditorShellRefs = {
  parentRef: RefObject<HTMLDivElement | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<EditorView | null>;
  codemirrorBootExtensionsRef: RefObject<readonly Extension[] | null>;
  initialMarkdownRef: RefObject<string>;
  readOnlyRef: RefObject<boolean>;
  onEditableBlurRef: RefObject<NoteMarkdownEditorProps['onEditableBlur']>;
  wikiLinkTargetIsResolvedRef: RefObject<
    NoteMarkdownEditorProps['wikiLinkTargetIsResolved']
  >;
  relativeMarkdownLinkHrefIsResolvedRef: RefObject<
    NoteMarkdownEditorProps['relativeMarkdownLinkHrefIsResolved']
  >;
  onMarkdownChangeRef: RefObject<NoteMarkdownEditorProps['onMarkdownChange']>;
  onEditorErrorRef: RefObject<NoteMarkdownEditorProps['onEditorError']>;
  onWikiLinkActivateRef: RefObject<
    NoteMarkdownEditorProps['onWikiLinkActivate']
  >;
  onMarkdownRelativeLinkActivateRef: RefObject<
    NoteMarkdownEditorProps['onMarkdownRelativeLinkActivate']
  >;
  onMarkdownExternalLinkOpenRef: RefObject<
    NoteMarkdownEditorProps['onMarkdownExternalLinkOpen']
  >;
  onSaveShortcutRef: RefObject<NoteMarkdownEditorProps['onSaveShortcut']>;
  modEnterSaveWhenNoLinkRef: RefObject<boolean>;
  onDeleteNoteShortcutRef: RefObject<
    NoteMarkdownEditorProps['onDeleteNoteShortcut']
  >;
  onFoldedRangesPresentChangeRef: RefObject<
    NoteMarkdownEditorProps['onFoldedRangesPresentChange']
  >;
  onFoldableRangesPresentChangeRef: RefObject<
    NoteMarkdownEditorProps['onFoldableRangesPresentChange']
  >;
  onMuteLinkSnippetDomainRef: RefObject<
    NoteMarkdownEditorProps['onMuteLinkSnippetDomain']
  >;
  vaultRootRef: RefObject<string>;
  activeNotePathRef: RefObject<string | null>;
  busyRef: RefObject<boolean>;
  attachmentHostRef: RefObject<NoteInboxAttachmentHost>;
  resolveVaultImagePreviewUrlRef: RefObject<VaultImagePreviewUrlResolver>;
  wikiLinkCompletionCandidatesRef: RefObject<
    readonly InboxWikiLinkCompletionCandidate[]
  >;
  linkRichPreviewRefsRef: RefObject<LinkRichPreviewRefs>;
  wikiLinkCompartmentRef: RefObject<Compartment>;
  relativeMdLinkCompartmentRef: RefObject<Compartment>;
  readOnlyCompartmentRef: RefObject<Compartment>;
  tableCellContextMenuOpenRef: RefObject<TableCellContextMenuOpen | null>;
  reportEditorError: (message: string) => void;
};

export function useNoteMarkdownEditorShellRefs(
  props: NoteMarkdownEditorProps,
  readOnly: boolean,
): NoteMarkdownEditorShellRefs {
  const {
    vaultRoot,
    attachmentHost,
    resolveVaultImagePreviewUrl,
    initialMarkdown,
    onMarkdownChange,
    onEditorError,
    onWikiLinkActivate,
    relativeMarkdownLinkHrefIsResolved,
    onMarkdownRelativeLinkActivate,
    onMarkdownExternalLinkOpen,
    wikiLinkTargetIsResolved,
    wikiLinkCompletionCandidates = [],
    onSaveShortcut,
    modEnterSaveWhenNoLink = false,
    onDeleteNoteShortcut,
    onFoldedRangesPresentChange,
    onFoldableRangesPresentChange,
    onEditableBlur,
    linkSnippetBlockedDomains,
    onMuteLinkSnippetDomain,
  } = props;

  const readOnlyRef = useRef(readOnly);
  const onEditableBlurRef = useRef(onEditableBlur);

  const parentRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codemirrorBootExtensionsRef = useRef<readonly Extension[] | null>(null);

  const wikiLinkTargetIsResolvedRef = useRef(wikiLinkTargetIsResolved);
  const relativeMarkdownLinkHrefIsResolvedRef = useRef(
    relativeMarkdownLinkHrefIsResolved,
  );
  const initialMarkdownRef = useRef(initialMarkdown);

  const onMarkdownChangeRef = useRef(onMarkdownChange);
  useEffect(() => {
    onMarkdownChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  const onEditorErrorRef = useRef(onEditorError);
  useEffect(() => {
    onEditorErrorRef.current = onEditorError;
  }, [onEditorError]);

  const onWikiLinkActivateRef = useRef(onWikiLinkActivate);
  useEffect(() => {
    onWikiLinkActivateRef.current = onWikiLinkActivate;
  }, [onWikiLinkActivate]);

  const onMarkdownRelativeLinkActivateRef = useRef(
    onMarkdownRelativeLinkActivate,
  );
  useEffect(() => {
    onMarkdownRelativeLinkActivateRef.current = onMarkdownRelativeLinkActivate;
  }, [onMarkdownRelativeLinkActivate]);

  const onMarkdownExternalLinkOpenRef = useRef(onMarkdownExternalLinkOpen);
  useEffect(() => {
    onMarkdownExternalLinkOpenRef.current = onMarkdownExternalLinkOpen;
  }, [onMarkdownExternalLinkOpen]);

  const onSaveShortcutRef = useRef(onSaveShortcut);
  const modEnterSaveWhenNoLinkRef = useRef(modEnterSaveWhenNoLink);
  const onDeleteNoteShortcutRef = useRef(onDeleteNoteShortcut);

  const onFoldedRangesPresentChangeRef = useRef(onFoldedRangesPresentChange);
  useEffect(() => {
    onFoldedRangesPresentChangeRef.current = onFoldedRangesPresentChange;
  }, [onFoldedRangesPresentChange]);

  const onFoldableRangesPresentChangeRef = useRef(onFoldableRangesPresentChange);
  useEffect(() => {
    onFoldableRangesPresentChangeRef.current = onFoldableRangesPresentChange;
  }, [onFoldableRangesPresentChange]);

  const reportEditorError = useCallback((message: string) => {
    console.error(message);
    onEditorErrorRef.current?.(message);
  }, [onEditorErrorRef]);

  const vaultRootRef = useRef(vaultRoot);
  const activeNotePathRef = useRef(props.activeNotePath);
  const busyRef = useRef(props.busy);
  const attachmentHostRef = useRef(attachmentHost);
  const resolveVaultImagePreviewUrlRef = useRef(resolveVaultImagePreviewUrl);
  const wikiLinkCompletionCandidatesRef = useRef(wikiLinkCompletionCandidates);

  useLayoutEffect(() => {
    readOnlyRef.current = readOnly;
    onEditableBlurRef.current = onEditableBlur;
    wikiLinkTargetIsResolvedRef.current = wikiLinkTargetIsResolved;
    relativeMarkdownLinkHrefIsResolvedRef.current =
      relativeMarkdownLinkHrefIsResolved;
    initialMarkdownRef.current = initialMarkdown;
    onSaveShortcutRef.current = onSaveShortcut;
    modEnterSaveWhenNoLinkRef.current = modEnterSaveWhenNoLink;
    onDeleteNoteShortcutRef.current = onDeleteNoteShortcut;
    vaultRootRef.current = vaultRoot;
    activeNotePathRef.current = props.activeNotePath;
    busyRef.current = props.busy;
    attachmentHostRef.current = attachmentHost;
    resolveVaultImagePreviewUrlRef.current = resolveVaultImagePreviewUrl;
    wikiLinkCompletionCandidatesRef.current = wikiLinkCompletionCandidates;
  });

  const onMuteLinkSnippetDomainRef = useRef(onMuteLinkSnippetDomain);
  useEffect(() => {
    onMuteLinkSnippetDomainRef.current = onMuteLinkSnippetDomain;
  }, [onMuteLinkSnippetDomain]);

  const linkRichPreviewRefsRef = useRef<LinkRichPreviewRefs>({
    onOpenLink: (href, at) =>
      onMarkdownExternalLinkOpenRef.current({href, at}),
    blockedDomains: new Set(),
  });

  useEffect(() => {
    linkRichPreviewRefsRef.current.blockedDomains = new Set(
      linkSnippetBlockedDomains ?? [],
    );
    viewRef.current?.dispatch({
      effects: linkRichBlockedDomainsBumpEffect.of(null),
    });
  }, [linkSnippetBlockedDomains]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) {
      return;
    }
    const spec = {effects: vaultImagePreviewContextBumpEffect.of(null)};
    v.dispatch(spec);
    dispatchEskerraTableNestedCellEditors(v, spec);
  }, [vaultRoot, props.activeNotePath]);

  const wikiLinkCompartmentRef = useRef(new Compartment());
  const relativeMdLinkCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const tableCellContextMenuOpenRef = useRef<TableCellContextMenuOpen | null>(
    null,
  );

  return {
    parentRef,
    hostRef,
    viewRef,
    codemirrorBootExtensionsRef,
    initialMarkdownRef,
    readOnlyRef,
    onEditableBlurRef,
    wikiLinkTargetIsResolvedRef,
    relativeMarkdownLinkHrefIsResolvedRef,
    onMarkdownChangeRef,
    onEditorErrorRef,
    onWikiLinkActivateRef,
    onMarkdownRelativeLinkActivateRef,
    onMarkdownExternalLinkOpenRef,
    onSaveShortcutRef,
    modEnterSaveWhenNoLinkRef,
    onDeleteNoteShortcutRef,
    onFoldedRangesPresentChangeRef,
    onFoldableRangesPresentChangeRef,
    onMuteLinkSnippetDomainRef,
    vaultRootRef,
    activeNotePathRef,
    busyRef,
    attachmentHostRef,
    resolveVaultImagePreviewUrlRef,
    wikiLinkCompletionCandidatesRef,
    linkRichPreviewRefsRef,
    wikiLinkCompartmentRef,
    relativeMdLinkCompartmentRef,
    readOnlyCompartmentRef,
    tableCellContextMenuOpenRef,
    reportEditorError,
  };
}
