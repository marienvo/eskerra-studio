import type {Dispatch, MutableRefObject, RefObject, SetStateAction} from 'react';

import {
  buildInboxMarkdownFromCompose,
  markdownContainsTransientImageUrls,
  mergeYamlFrontmatterBody,
  parseComposeInput,
  type SubtreeMarkdownPresenceCache,
  type VaultFilesystem,
} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../editor/noteEditor/NoteMarkdownEditor';
import {cleanNoteMarkdownBody} from '../lib/cleanNoteMarkdown';
import {normalizeEditorDocUri} from '../lib/editorDocumentHistory';
import {innerToFencedFrontmatterBlock} from '../lib/inboxYamlFrontmatterEditor';
import {persistTransientMarkdownImages} from '../lib/persistTransientMarkdownImages';
import {createInboxMarkdownNote} from '../lib/vaultBootstrap';
import {
  mergeInboxNoteBodyIntoCache,
  type LastPersisted,
} from './inboxNoteBodyCache';
import type {DiskConflictSoftState, DiskConflictState} from './workspaceFsWatchReconcile';
import type {InboxEditorShellScrollDirective} from './workspaceEditorScrollMap';

export type ComposeCommandsContext = {
  fs: VaultFilesystem;
  vaultRoot: string | null;
  subtreeMarkdownCache: SubtreeMarkdownPresenceCache;
  markVaultWriteSettled: () => void;
  refreshNotes: (root: string) => Promise<void>;
  flushInboxSave: () => Promise<void>;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string | null,
    selection?: 'start' | 'end' | 'preserve',
  ) => void;
  resetInboxEditorComposeState: () => void;
  todayHubCleanRowBlocked: (rowUri: string) => boolean;
  showTodayHubCanvasRef: MutableRefObject<boolean>;
  todayHubBridgeRef: MutableRefObject<{
    flushPendingEdits: () => Promise<void>;
    cleanHubPageDayColumns: () => Promise<void>;
  }>;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  refs: {
    selectedUriRef: MutableRefObject<string | null>;
    composingNewEntryRef: MutableRefObject<boolean>;
    inboxEditorShellScrollDirectiveRef: MutableRefObject<InboxEditorShellScrollDirective | null>;
    diskConflictRef: MutableRefObject<DiskConflictState | null>;
    diskConflictSoftRef: MutableRefObject<DiskConflictSoftState | null>;
    lastPersistedRef: MutableRefObject<LastPersisted | null>;
    lastPersistedExternalMutationSeqRef: MutableRefObject<number>;
    editorBodyRef: MutableRefObject<string>;
    inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
    inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
    inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  };
  setters: {
    setBusy: Dispatch<SetStateAction<boolean>>;
    setErr: Dispatch<SetStateAction<string | null>>;
    setFsRefreshNonce: Dispatch<SetStateAction<number>>;
    setEditorBody: Dispatch<SetStateAction<string>>;
    setComposingNewEntry: Dispatch<SetStateAction<boolean>>;
    setSelectedUri: Dispatch<SetStateAction<string | null>>;
    setDiskConflict: Dispatch<SetStateAction<DiskConflictState | null>>;
    setDiskConflictSoft: Dispatch<SetStateAction<DiskConflictSoftState | null>>;
    setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  };
  openMarkdownInEditor: (uri: string) => Promise<void>;
};

export async function runAddNote(
  ctx: ComposeCommandsContext,
  title: string,
  body: string,
): Promise<void> {
  const {vaultRoot, fs, subtreeMarkdownCache, markVaultWriteSettled, refreshNotes} = ctx;
  if (!vaultRoot) {
    return;
  }
  ctx.setters.setBusy(true);
  ctx.setters.setErr(null);
  try {
    const created = await createInboxMarkdownNote(vaultRoot, fs, title, body);
    markVaultWriteSettled();
    subtreeMarkdownCache.invalidateForMutation(vaultRoot, created.uri, 'file');
    await refreshNotes(vaultRoot);
    ctx.setters.setFsRefreshNonce(n => n + 1);
    await ctx.openMarkdownInEditor(created.uri);
  } catch (e) {
    ctx.setters.setErr(e instanceof Error ? e.message : String(e));
  } finally {
    ctx.setters.setBusy(false);
  }
}

export function runStartNewEntry(ctx: ComposeCommandsContext): void {
  void (async () => {
    await ctx.flushInboxSave();
    ctx.setters.setErr(null);
    ctx.setters.setDiskConflict(null);
    ctx.refs.diskConflictRef.current = null;
    ctx.setters.setDiskConflictSoft(null);
    ctx.refs.diskConflictSoftRef.current = null;
    ctx.refs.inboxEditorShellScrollDirectiveRef.current = {kind: 'snapTop'};
    ctx.setters.setComposingNewEntry(true);
    ctx.setters.setSelectedUri(null);
    ctx.refs.lastPersistedRef.current = null;
    ctx.refs.lastPersistedExternalMutationSeqRef.current += 1;
    ctx.resetInboxEditorComposeState();
  })();
}

export function runCancelNewEntry(ctx: ComposeCommandsContext): void {
  void (async () => {
    await ctx.flushInboxSave();
    ctx.setters.setComposingNewEntry(false);
    ctx.resetInboxEditorComposeState();
  })();
}

export async function runSubmitNewEntry(
  ctx: ComposeCommandsContext,
  editorBody: string,
): Promise<void> {
  if (!ctx.vaultRoot) {
    return;
  }
  ctx.setters.setErr(null);
  const rawBody = ctx.inboxEditorRef.current?.getMarkdown() ?? editorBody;
  let body = rawBody;
  try {
    body = await persistTransientMarkdownImages(body, ctx.vaultRoot);
  } catch (e) {
    ctx.setters.setErr(e instanceof Error ? e.message : String(e));
    return;
  }
  if (markdownContainsTransientImageUrls(body)) {
    ctx.setters.setErr(
      'Cannot create this note: some images are still temporary (blob or data URLs). Paste images again so they are stored under Assets/Attachments, or remove those image references.',
    );
    return;
  }
  if (body !== rawBody) {
    ctx.inboxEditorRef.current?.loadMarkdown(body, {selection: 'preserve'});
    ctx.scheduleBacklinksDeferOneFrameAfterLoad();
    ctx.setters.setEditorBody(body);
  }
  const {titleLine, bodyAfterBlank} = parseComposeInput(body);
  if (!titleLine.trim()) {
    ctx.setters.setErr('First line is required.');
    return;
  }
  const fullMarkdown = buildInboxMarkdownFromCompose(titleLine, bodyAfterBlank);
  await runAddNote(ctx, titleLine, fullMarkdown);
}

export function runCleanNoteInbox(ctx: ComposeCommandsContext): void {
  const uri = ctx.refs.selectedUriRef.current;
  if (!uri || ctx.refs.composingNewEntryRef.current) {
    return;
  }
  if (ctx.todayHubCleanRowBlocked(uri)) {
    return;
  }

  const slice = ctx.inboxEditorRef.current?.getMarkdown() ?? ctx.refs.editorBodyRef.current;
  const cleanedSlice = cleanNoteMarkdownBody(slice, uri);
  if (cleanedSlice !== slice) {
    const innerFm = ctx.refs.inboxYamlFrontmatterInnerRef.current;
    const full = mergeYamlFrontmatterBody(
      innerFm == null ? null : innerToFencedFrontmatterBlock(innerFm),
      cleanedSlice,
      ctx.refs.inboxEditorYamlLeadingBeforeFrontmatterRef.current,
    );
    ctx.loadFullMarkdownIntoInboxEditor(full, uri, 'preserve');
    ctx.scheduleBacklinksDeferOneFrameAfterLoad();
    const norm = normalizeEditorDocUri(uri);
    const nextCache = mergeInboxNoteBodyIntoCache(
      ctx.refs.inboxContentByUriRef.current,
      norm,
      full,
    );
    if (nextCache) {
      ctx.refs.inboxContentByUriRef.current = nextCache;
      ctx.setters.setInboxContentByUri(prev =>
        mergeInboxNoteBodyIntoCache(prev, norm, full) ?? prev,
      );
    }
  }

  const runHubClean = async () => {
    if (!ctx.showTodayHubCanvasRef.current || ctx.refs.composingNewEntryRef.current) {
      return;
    }
    const hubTodayUri = ctx.refs.selectedUriRef.current;
    if (!hubTodayUri || ctx.todayHubCleanRowBlocked(hubTodayUri)) {
      return;
    }
    await ctx.todayHubBridgeRef.current.flushPendingEdits().catch(() => undefined);
    await ctx.todayHubBridgeRef.current.cleanHubPageDayColumns().catch(() => undefined);
  };
  void runHubClean();
}
