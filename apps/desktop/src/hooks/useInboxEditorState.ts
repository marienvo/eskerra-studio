import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  fencedFrontmatterBlockToInner,
  splitYamlFrontmatter,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import type {NoteMarkdownLoadSelection} from '../editor/noteEditor/noteMarkdownLoadMarkdown';
import {clearInboxYamlFrontmatterEditorRefs} from '../lib/inboxYamlFrontmatterEditor';
import type {InboxEditorShellScrollDirective} from './workspaceEditorScrollMap';

type UseInboxEditorStateOptions = {
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
};

export type UseInboxEditorStateResult = {
  selectedUri: string | null;
  setSelectedUri: Dispatch<SetStateAction<string | null>>;
  selectedUriRef: MutableRefObject<string | null>;
  editorBody: string;
  setEditorBody: Dispatch<SetStateAction<string>>;
  editorBodyRef: MutableRefObject<string>;
  guardedSetEditorBody: Dispatch<SetStateAction<string>>;
  inboxEditorResetNonce: number;
  setInboxEditorResetNonce: Dispatch<SetStateAction<number>>;
  composeDraftMarkdown: string;
  setComposeDraftMarkdown: Dispatch<SetStateAction<string>>;
  composeDraftResetNonce: number;
  setComposeDraftResetNonce: Dispatch<SetStateAction<number>>;
  lastInboxEditorActivityAtRef: MutableRefObject<number>;
  skipRecencyDeferForUriRef: MutableRefObject<Set<string>>;
  composingNewEntry: boolean;
  setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
  composingNewEntryRef: MutableRefObject<boolean>;
  inboxYamlFrontmatterInner: string | null;
  setInboxYamlFrontmatterInner: Dispatch<SetStateAction<string | null>>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatter: string;
  setInboxEditorYamlLeadingBeforeFrontmatter: Dispatch<SetStateAction<string>>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  suppressEditorOnChangeRef: MutableRefObject<boolean>;
  eagerEditorLoadUriRef: MutableRefObject<string | null>;
  editorShellScrollByUriRef: MutableRefObject<Map<string, {top: number; left: number}>>;
  inboxEditorShellScrollDirectiveRef: MutableRefObject<InboxEditorShellScrollDirective | null>;
  syncFrontmatterStateFromDisk: (nextInner: string | null, leading: string) => void;
  applyFrontmatterInnerChange: (nextInner: string | null) => void;
  loadFullMarkdownIntoInboxEditor: (
    full: string,
    uri: string | null,
    selection?: NoteMarkdownLoadSelection,
  ) => void;
  resetInboxEditorComposeState: () => void;
  clearInboxSelection: () => void;
};

export function useInboxEditorState(
  options: UseInboxEditorStateOptions,
): UseInboxEditorStateResult {
  const {inboxEditorRef} = options;

  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [inboxEditorResetNonce, setInboxEditorResetNonce] = useState(0);
  const [composeDraftMarkdown, setComposeDraftMarkdown] = useState('');
  const [composeDraftResetNonce, setComposeDraftResetNonce] = useState(0);
  const lastInboxEditorActivityAtRef = useRef(0);
  const skipRecencyDeferForUriRef = useRef<Set<string>>(new Set());
  const [composingNewEntry, setComposingNewEntry] = useState(false);
  const selectedUriRef = useRef<string | null>(null);
  const composingNewEntryRef = useRef(false);
  const editorBodyRef = useRef('');
  const eagerEditorLoadUriRef = useRef<string | null>(null);
  const suppressEditorOnChangeRef = useRef(false);
  const [inboxYamlFrontmatterInner, setInboxYamlFrontmatterInner] = useState<string | null>(
    null,
  );
  const inboxYamlFrontmatterInnerRef = useRef<string | null>(null);
  const [inboxEditorYamlLeadingBeforeFrontmatter, setInboxEditorYamlLeadingBeforeFrontmatter] =
    useState('');
  const inboxEditorYamlLeadingBeforeFrontmatterRef = useRef('');
  const editorShellScrollByUriRef = useRef(new Map<string, {top: number; left: number}>());
  const inboxEditorShellScrollDirectiveRef =
    useRef<InboxEditorShellScrollDirective | null>(null);

  useLayoutEffect(() => {
    selectedUriRef.current = selectedUri;
  }, [selectedUri]);

  useLayoutEffect(() => {
    composingNewEntryRef.current = composingNewEntry;
  }, [composingNewEntry]);

  useLayoutEffect(() => {
    editorBodyRef.current = editorBody;
  }, [editorBody]);

  useLayoutEffect(() => {
    inboxYamlFrontmatterInnerRef.current = inboxYamlFrontmatterInner;
  }, [inboxYamlFrontmatterInner]);

  useLayoutEffect(() => {
    inboxEditorYamlLeadingBeforeFrontmatterRef.current =
      inboxEditorYamlLeadingBeforeFrontmatter;
  }, [inboxEditorYamlLeadingBeforeFrontmatter]);

  const syncFrontmatterStateFromDisk = useCallback((nextInner: string | null, leading: string) => {
    inboxYamlFrontmatterInnerRef.current = nextInner;
    setInboxYamlFrontmatterInner(nextInner);
    inboxEditorYamlLeadingBeforeFrontmatterRef.current = leading;
    setInboxEditorYamlLeadingBeforeFrontmatter(leading);
  }, []);

  const applyFrontmatterInnerChange = useCallback((nextInner: string | null) => {
    if (composingNewEntryRef.current) {
      return;
    }
    if (!selectedUriRef.current) {
      return;
    }
    inboxYamlFrontmatterInnerRef.current = nextInner;
    setInboxYamlFrontmatterInner(nextInner);
  }, []);

  const guardedSetEditorBody: Dispatch<SetStateAction<string>> = useCallback(value => {
    if (suppressEditorOnChangeRef.current) return;
    lastInboxEditorActivityAtRef.current = Date.now();
    setEditorBody(value);
  }, []);

  const loadFullMarkdownIntoInboxEditor = useCallback(
    (
      full: string,
      uri: string | null,
      selection: NoteMarkdownLoadSelection = 'start',
    ) => {
      const composing = composingNewEntryRef.current;
      if (!uri || composing) {
        syncFrontmatterStateFromDisk(null, '');
        suppressEditorOnChangeRef.current = true;
        inboxEditorRef.current?.loadMarkdown(full, {selection});
        suppressEditorOnChangeRef.current = false;
        const loadedBody =
          selection === 'openNote'
            ? (inboxEditorRef.current?.getMarkdown() ?? full)
            : full;
        setEditorBody(loadedBody);
        editorBodyRef.current = loadedBody;
        return;
      }
      const {frontmatter, body, leadingBeforeFrontmatter} = splitYamlFrontmatter(full);
      const inner =
        frontmatter !== null ? fencedFrontmatterBlockToInner(frontmatter) : null;
      syncFrontmatterStateFromDisk(
        inner,
        frontmatter !== null ? leadingBeforeFrontmatter : '',
      );
      suppressEditorOnChangeRef.current = true;
      inboxEditorRef.current?.loadMarkdown(body, {selection});
      suppressEditorOnChangeRef.current = false;
      const loadedBody =
        selection === 'openNote'
          ? (inboxEditorRef.current?.getMarkdown() ?? body)
          : body;
      setEditorBody(loadedBody);
      editorBodyRef.current = loadedBody;
    },
    [inboxEditorRef, syncFrontmatterStateFromDisk],
  );

  const resetInboxEditorComposeState = useCallback(() => {
    clearInboxYamlFrontmatterEditorRefs({
      inner: inboxYamlFrontmatterInnerRef,
      leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
      setInner: setInboxYamlFrontmatterInner,
      setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
    });
    setEditorBody('');
    setInboxEditorResetNonce(n => n + 1);
  }, []);

  const clearInboxSelection = useCallback(() => {
    selectedUriRef.current = null;
    composingNewEntryRef.current = false;
    setSelectedUri(null);
    setComposingNewEntry(false);
    resetInboxEditorComposeState();
  }, [resetInboxEditorComposeState]);

  return {
    selectedUri,
    setSelectedUri,
    selectedUriRef,
    editorBody,
    setEditorBody,
    editorBodyRef,
    guardedSetEditorBody,
    inboxEditorResetNonce,
    setInboxEditorResetNonce,
    composeDraftMarkdown,
    setComposeDraftMarkdown,
    composeDraftResetNonce,
    setComposeDraftResetNonce,
    lastInboxEditorActivityAtRef,
    skipRecencyDeferForUriRef,
    composingNewEntry,
    setComposingNewEntry,
    composingNewEntryRef,
    inboxYamlFrontmatterInner,
    setInboxYamlFrontmatterInner,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatter,
    setInboxEditorYamlLeadingBeforeFrontmatter,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    suppressEditorOnChangeRef,
    eagerEditorLoadUriRef,
    editorShellScrollByUriRef,
    inboxEditorShellScrollDirectiveRef,
    syncFrontmatterStateFromDisk,
    applyFrontmatterInnerChange,
    loadFullMarkdownIntoInboxEditor,
    resetInboxEditorComposeState,
    clearInboxSelection,
  };
}
