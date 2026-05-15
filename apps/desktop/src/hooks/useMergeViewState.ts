import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {VaultFilesystem} from '@eskerra/core';
import {isVaultPathUnderAutosyncBackup} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {inboxEditorSliceToFullMarkdown} from '../lib/inboxYamlFrontmatterEditor';
import {resolveVaultLinkBaseMarkdownUri} from '../lib/resolveVaultLinkBaseMarkdownUri';
import {mergeInboxNoteBodyIntoCache} from './inboxNoteBodyCache';
import type {DiskConflictSoftState, DiskConflictState, LastPersisted} from './workspaceFsWatchReconcile';

export type WorkspaceMergeView =
  | null
  | {kind: 'backup'; baseUri: string; backupUri: string}
  | {kind: 'diskConflict'; baseUri: string; diskMarkdown: string};

type UseMergeViewStateOptions = {
  fs: VaultFilesystem;
  openMarkdownInEditor: (
    uri: string,
    options?: {skipHistory?: boolean},
  ) => Promise<void>;
  selectedUriRef: MutableRefObject<string | null>;
  composingNewEntryRef: MutableRefObject<boolean>;
  showTodayHubCanvasRef: MutableRefObject<boolean>;
  todayHubWikiNavParentRef: MutableRefObject<string | null>;
  diskConflictRef: MutableRefObject<DiskConflictState | null>;
  diskConflictSoftRef: MutableRefObject<DiskConflictSoftState | null>;
  setDiskConflict: Dispatch<SetStateAction<DiskConflictState | null>>;
  setDiskConflictSoft: Dispatch<SetStateAction<DiskConflictSoftState | null>>;
  resolveDiskConflictReloadFromDisk: () => void;
  resolveDiskConflictKeepLocal: () => void;
  cancelAutosave: () => void;
  setErr: Dispatch<SetStateAction<string | null>>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  loadFullMarkdownIntoInboxEditor: (
    full: string,
    uri: string,
    selection: 'start' | 'preserve',
  ) => void;
  editorBodyRef: MutableRefObject<string>;
  setEditorBody: Dispatch<SetStateAction<string>>;
  suppressEditorOnChangeRef: MutableRefObject<boolean>;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  backlinksActiveBodyRef: MutableRefObject<string>;
  setBacklinksActiveBody: Dispatch<SetStateAction<string>>;
  enqueuePersistOutgoingNoteMarkdown: (uri: string, markdown: string) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  lastPersistedRef: MutableRefObject<LastPersisted | null>;
  lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
};

export type UseMergeViewStateResult = {
  mergeView: WorkspaceMergeView;
  closeMergeView: () => void;
  tryEnterBackupMergeView: (backupUri: string) => Promise<boolean>;
  applyFullBackupFromMerge: () => Promise<void>;
  keepMyEditsFromMerge: () => void;
  enterDiskConflictMergeView: () => void;
  applyMergedBodyFromMerge: (body: string) => void;
};

export function useMergeViewState(options: UseMergeViewStateOptions): UseMergeViewStateResult {
  const {
    fs,
    openMarkdownInEditor,
    selectedUriRef,
    composingNewEntryRef,
    showTodayHubCanvasRef,
    todayHubWikiNavParentRef,
    diskConflictRef,
    diskConflictSoftRef,
    setDiskConflict,
    setDiskConflictSoft,
    resolveDiskConflictReloadFromDisk,
    resolveDiskConflictKeepLocal,
    cancelAutosave,
    setErr,
    inboxEditorRef,
    loadFullMarkdownIntoInboxEditor,
    editorBodyRef,
    setEditorBody,
    suppressEditorOnChangeRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxContentByUriRef,
    setInboxContentByUri,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    enqueuePersistOutgoingNoteMarkdown,
    scheduleBacklinksDeferOneFrameAfterLoad,
    lastPersistedRef,
    lastPersistedExternalMutationSeqRef,
  } = options;

  const [mergeView, setMergeView] = useState<WorkspaceMergeView>(null);

  const closeMergeView = useCallback(() => {
    setMergeView(null);
  }, []);

  const tryEnterBackupMergeView = useCallback(
    async (backupUri: string): Promise<boolean> => {
      if (!isVaultPathUnderAutosyncBackup(backupUri)) {
        return false;
      }
      const baseUri = resolveVaultLinkBaseMarkdownUri({
        composingNewEntry: composingNewEntryRef.current,
        showTodayHubCanvas: showTodayHubCanvasRef.current,
        todayHubWikiNavParentUri: todayHubWikiNavParentRef.current,
        selectedUri: selectedUriRef.current,
      });
      if (!baseUri) {
        return false;
      }
      const normBase = normalizeEditorDocUri(baseUri);
      const normBackup = normalizeEditorDocUri(backupUri);
      const cur = selectedUriRef.current
        ? normalizeEditorDocUri(selectedUriRef.current)
        : null;
      if (cur !== normBase) {
        await openMarkdownInEditor(normBase, {skipHistory: true});
      }
      setMergeView({kind: 'backup', baseUri: normBase, backupUri: normBackup});
      return true;
    },
    [
      composingNewEntryRef,
      openMarkdownInEditor,
      selectedUriRef,
      showTodayHubCanvasRef,
      todayHubWikiNavParentRef,
    ],
  );

  const applyFullBackupFromMerge = useCallback(async () => {
    const mv = mergeView;
    if (!mv) {
      return;
    }
    if (mv.kind === 'diskConflict') {
      resolveDiskConflictReloadFromDisk();
      setMergeView(null);
      return;
    }
    const normBase = normalizeEditorDocUri(mv.baseUri);
    const dc = diskConflictRef.current;
    if (dc && normalizeEditorDocUri(dc.uri) === normBase) {
      setErr(
        'Resolve the disk conflict on this note before replacing it from a backup.',
      );
      return;
    }
    try {
      setErr(null);
      const raw = await fs.readFile(mv.backupUri, {encoding: 'utf8'});
      loadFullMarkdownIntoInboxEditor(raw, normBase, 'start');
      const body =
        inboxEditorRef.current?.getMarkdown() ?? editorBodyRef.current;
      const full = inboxEditorSliceToFullMarkdown(
        body,
        normBase,
        false,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      const nextCache = mergeInboxNoteBodyIntoCache(
        inboxContentByUriRef.current,
        normBase,
        body,
      );
      if (nextCache) {
        inboxContentByUriRef.current = nextCache;
        setInboxContentByUri(
          prev => mergeInboxNoteBodyIntoCache(prev, normBase, body) ?? prev,
        );
      }
      backlinksActiveBodyRef.current = body;
      setBacklinksActiveBody(body);
      setMergeView(null);
      enqueuePersistOutgoingNoteMarkdown(normBase, full);
      scheduleBacklinksDeferOneFrameAfterLoad();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    mergeView,
    resolveDiskConflictReloadFromDisk,
    diskConflictRef,
    setErr,
    fs,
    loadFullMarkdownIntoInboxEditor,
    inboxEditorRef,
    editorBodyRef,
    inboxYamlFrontmatterInnerRef,
    inboxEditorYamlLeadingBeforeFrontmatterRef,
    inboxContentByUriRef,
    setInboxContentByUri,
    backlinksActiveBodyRef,
    setBacklinksActiveBody,
    enqueuePersistOutgoingNoteMarkdown,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

  const keepMyEditsFromMerge = useCallback(() => {
    resolveDiskConflictKeepLocal();
    setMergeView(null);
  }, [resolveDiskConflictKeepLocal]);

  const enterDiskConflictMergeView = useCallback(() => {
    const uri = selectedUriRef.current;
    if (!uri) return;
    const normUri = normalizeEditorDocUri(uri);

    const dc = diskConflictRef.current;
    if (dc && normalizeEditorDocUri(dc.uri) === normUri) {
      setMergeView({kind: 'diskConflict', baseUri: normUri, diskMarkdown: dc.diskMarkdown});
      return;
    }

    const s = diskConflictSoftRef.current;
    if (s && normalizeEditorDocUri(s.uri) === normUri) {
      cancelAutosave();
      const hard: DiskConflictState = {uri: s.uri, diskMarkdown: s.diskMarkdown};
      setDiskConflict(hard);
      diskConflictRef.current = hard;
      setDiskConflictSoft(null);
      diskConflictSoftRef.current = null;
      setMergeView({kind: 'diskConflict', baseUri: normUri, diskMarkdown: s.diskMarkdown});
    }
  }, [
    cancelAutosave,
    diskConflictRef,
    diskConflictSoftRef,
    selectedUriRef,
    setDiskConflict,
    setDiskConflictSoft,
  ]);

  const applyMergedBodyFromMerge = useCallback(
    (body: string) => {
      const mv = mergeView;
      if (!mv) return;
      const normBase = normalizeEditorDocUri(mv.baseUri);

      if (mv.kind === 'diskConflict') {
        cancelAutosave();
        const dc = diskConflictRef.current;
        if (dc) {
          lastPersistedRef.current = {uri: dc.uri, markdown: dc.diskMarkdown};
          lastPersistedExternalMutationSeqRef.current += 1;
        }
        setDiskConflict(null);
        diskConflictRef.current = null;
        setDiskConflictSoft(null);
        diskConflictSoftRef.current = null;
      } else {
        const dc = diskConflictRef.current;
        if (dc && normalizeEditorDocUri(dc.uri) === normBase) {
          setErr('Resolve the disk conflict on this note before applying a merge.');
          return;
        }
      }

      suppressEditorOnChangeRef.current = true;
      inboxEditorRef.current?.loadMarkdown(body, {selection: 'preserve'});
      suppressEditorOnChangeRef.current = false;
      setEditorBody(body);
      editorBodyRef.current = body;

      const nextCache = mergeInboxNoteBodyIntoCache(
        inboxContentByUriRef.current,
        normBase,
        body,
      );
      if (nextCache) {
        inboxContentByUriRef.current = nextCache;
        setInboxContentByUri(prev => mergeInboxNoteBodyIntoCache(prev, normBase, body) ?? prev);
      }
      backlinksActiveBodyRef.current = body;
      setBacklinksActiveBody(body);
      setMergeView(null);

      const full = inboxEditorSliceToFullMarkdown(
        body,
        normBase,
        false,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      enqueuePersistOutgoingNoteMarkdown(normBase, full);
      scheduleBacklinksDeferOneFrameAfterLoad();
    },
    [
      mergeView,
      cancelAutosave,
      diskConflictRef,
      lastPersistedRef,
      lastPersistedExternalMutationSeqRef,
      setDiskConflict,
      setDiskConflictSoft,
      setErr,
      suppressEditorOnChangeRef,
      inboxEditorRef,
      setEditorBody,
      editorBodyRef,
      inboxContentByUriRef,
      setInboxContentByUri,
      backlinksActiveBodyRef,
      setBacklinksActiveBody,
      inboxYamlFrontmatterInnerRef,
      inboxEditorYamlLeadingBeforeFrontmatterRef,
      enqueuePersistOutgoingNoteMarkdown,
      scheduleBacklinksDeferOneFrameAfterLoad,
    ],
  );

  return {
    mergeView,
    closeMergeView,
    tryEnterBackupMergeView,
    applyFullBackupFromMerge,
    keepMyEditsFromMerge,
    enterDiskConflictMergeView,
    applyMergedBodyFromMerge,
  };
}
