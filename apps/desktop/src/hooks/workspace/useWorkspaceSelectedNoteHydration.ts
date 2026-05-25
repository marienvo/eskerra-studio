import {
  useEffect,
  useLayoutEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import type {NoteMarkdownEditorHandle} from '../../editor/noteEditor/NoteMarkdownEditor';
import type {NoteMarkdownLoadSelection} from '../../editor/noteEditor/noteMarkdownLoadMarkdown';
import {
  clearInboxYamlFrontmatterEditorRefs,
  inboxEditorSliceToFullMarkdown,
} from '../../lib/inboxYamlFrontmatterEditor';
import {
  mergeInboxNoteBodyIntoCache,
  normalizeVaultMarkdownDiskRead,
  resolveInboxCachedBodyForEditor,
} from '../inboxNoteBodyCache';

/** Debounce scan of the active note body for backlinks (full vault scan is too heavy per keystroke). */
const INBOX_BACKLINK_BODY_DEBOUNCE_MS = 200;

type UseWorkspaceSelectedNoteHydrationInput = {
  vaultRoot: string | null;
  selectedUri: string | null;
  composingNewEntry: boolean;
  editorBody: string;
  inboxYamlFrontmatterInner: string | null;
  fs: VaultFilesystem;
  inboxEditorRef: RefObject<NoteMarkdownEditorHandle | null>;
  eagerEditorLoadUriRef: MutableRefObject<string | null>;
  inboxContentByUriRef: MutableRefObject<Record<string, string>>;
  lastPersistedRef: MutableRefObject<{uri: string; markdown: string} | null>;
  setInboxContentByUri: Dispatch<SetStateAction<Record<string, string>>>;
  setLastPersistedSnapshot: (snapshot: {uri: string; markdown: string}) => void;
  clearLastPersistedSnapshot: () => void;
  loadFullMarkdownIntoInboxEditor: (
    markdown: string,
    uri: string,
    selection?: NoteMarkdownLoadSelection,
  ) => void;
  scheduleBacklinksDeferOneFrameAfterLoad: () => void;
  clearInboxBacklinksDeferAfterLoad: () => void;
  inboxYamlFrontmatterInnerRef: MutableRefObject<string | null>;
  inboxEditorYamlLeadingBeforeFrontmatterRef: MutableRefObject<string>;
  setInboxYamlFrontmatterInner: (value: string | null) => void;
  setInboxEditorYamlLeadingBeforeFrontmatter: (value: string) => void;
  setEditorBody: (value: string) => void;
  backlinksActiveBodyRef: MutableRefObject<string>;
  setBacklinksActiveBody: (value: string) => void;
  composingNewEntryRef: MutableRefObject<boolean>;
  editorBodyRef: MutableRefObject<string>;
  setErr: (value: string) => void;
};

export function useWorkspaceSelectedNoteHydration({
  vaultRoot,
  selectedUri,
  composingNewEntry,
  editorBody,
  inboxYamlFrontmatterInner,
  fs,
  inboxEditorRef,
  eagerEditorLoadUriRef,
  inboxContentByUriRef,
  lastPersistedRef,
  setInboxContentByUri,
  setLastPersistedSnapshot,
  clearLastPersistedSnapshot,
  loadFullMarkdownIntoInboxEditor,
  scheduleBacklinksDeferOneFrameAfterLoad,
  clearInboxBacklinksDeferAfterLoad,
  inboxYamlFrontmatterInnerRef,
  inboxEditorYamlLeadingBeforeFrontmatterRef,
  setInboxYamlFrontmatterInner,
  setInboxEditorYamlLeadingBeforeFrontmatter,
  setEditorBody,
  backlinksActiveBodyRef,
  setBacklinksActiveBody,
  composingNewEntryRef,
  editorBodyRef,
  setErr,
}: UseWorkspaceSelectedNoteHydrationInput) {
  useLayoutEffect(() => {
    if (!vaultRoot || !selectedUri) {
      clearInboxBacklinksDeferAfterLoad();
      return;
    }
    if (eagerEditorLoadUriRef.current === selectedUri) {
      eagerEditorLoadUriRef.current = null;
      return;
    }
    const cached = inboxContentByUriRef.current[selectedUri];
    if (cached !== undefined) {
      const {markdown: body, healedCache} = resolveInboxCachedBodyForEditor(
        selectedUri,
        cached,
        lastPersistedRef.current,
      );
      if (healedCache) {
        const healed = mergeInboxNoteBodyIntoCache(
          inboxContentByUriRef.current,
          selectedUri,
          body,
        );
        if (healed) {
          inboxContentByUriRef.current = healed;
          setInboxContentByUri(prev =>
            mergeInboxNoteBodyIntoCache(prev, selectedUri, body) ?? prev,
          );
        }
      }
      setLastPersistedSnapshot({uri: selectedUri, markdown: body});
      loadFullMarkdownIntoInboxEditor(body, selectedUri, 'openNote');
      scheduleBacklinksDeferOneFrameAfterLoad();
    } else {
      clearInboxBacklinksDeferAfterLoad();
      clearInboxYamlFrontmatterEditorRefs({
        inner: inboxYamlFrontmatterInnerRef,
        leading: inboxEditorYamlLeadingBeforeFrontmatterRef,
        setInner: setInboxYamlFrontmatterInner,
        setLeading: setInboxEditorYamlLeadingBeforeFrontmatter,
      });
      setEditorBody('');
      clearLastPersistedSnapshot();
    }
  }, [
    vaultRoot,
    selectedUri,
    inboxEditorRef,
    clearInboxBacklinksDeferAfterLoad,
    clearLastPersistedSnapshot,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    setLastPersistedSnapshot,
  ]);

  /**
   * Clear the open note in CodeMirror when the shell has no cached body yet.
   * Runs after `NoteMarkdownEditor`'s mount effect creates the view (parent layout is too early).
   */
  useEffect(() => {
    if (!vaultRoot || !selectedUri) {
      return;
    }
    if (inboxContentByUriRef.current[selectedUri] !== undefined) {
      return;
    }
    inboxYamlFrontmatterInnerRef.current = null;
    inboxEditorYamlLeadingBeforeFrontmatterRef.current = '';
    queueMicrotask(() => {
      setInboxYamlFrontmatterInner(null);
      setInboxEditorYamlLeadingBeforeFrontmatter('');
    });
    inboxEditorRef.current?.loadMarkdown('', {selection: 'start'});
    scheduleBacklinksDeferOneFrameAfterLoad();
  }, [
    vaultRoot,
    selectedUri,
    inboxEditorRef,
    scheduleBacklinksDeferOneFrameAfterLoad,
  ]);

  useLayoutEffect(() => {
    if (composingNewEntry || !selectedUri) {
      if (backlinksActiveBodyRef.current !== '') {
        queueMicrotask(() => {
          setBacklinksActiveBody('');
        });
      }
      return;
    }
    const snap = inboxContentByUriRef.current[selectedUri] ?? '';
    if (backlinksActiveBodyRef.current === snap) {
      return;
    }
    queueMicrotask(() => {
      setBacklinksActiveBody(snap);
    });
  }, [
    backlinksActiveBodyRef,
    composingNewEntry,
    selectedUri,
    setBacklinksActiveBody,
    vaultRoot,
  ]);

  useEffect(() => {
    if (composingNewEntry || !selectedUri) {
      return;
    }
    const id = window.setTimeout(() => {
      const liveFull = inboxEditorSliceToFullMarkdown(
        editorBody,
        selectedUri,
        composingNewEntry,
        inboxYamlFrontmatterInnerRef.current,
        inboxEditorYamlLeadingBeforeFrontmatterRef.current,
      );
      if (backlinksActiveBodyRef.current === liveFull) {
        return;
      }
      setBacklinksActiveBody(liveFull);
    }, INBOX_BACKLINK_BODY_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [
    backlinksActiveBodyRef,
    composingNewEntry,
    editorBody,
    inboxYamlFrontmatterInner,
    selectedUri,
    setBacklinksActiveBody,
  ]);

  useEffect(() => {
    if (!vaultRoot || !selectedUri) {
      return;
    }
    if (inboxContentByUriRef.current[selectedUri] !== undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await fs.readFile(selectedUri, {encoding: 'utf8'});
        if (!cancelled) {
          const normalized = normalizeVaultMarkdownDiskRead(raw);
          setLastPersistedSnapshot({uri: selectedUri, markdown: normalized});
          setInboxContentByUri(prev => {
            if (prev[selectedUri] === normalized) {
              return prev;
            }
            return {...prev, [selectedUri]: normalized};
          });
          const currentFull = inboxEditorSliceToFullMarkdown(
            editorBodyRef.current,
            selectedUri,
            composingNewEntryRef.current,
            inboxYamlFrontmatterInnerRef.current,
            inboxEditorYamlLeadingBeforeFrontmatterRef.current,
          );
          if (normalized !== currentFull) {
            loadFullMarkdownIntoInboxEditor(normalized, selectedUri, 'openNote');
            scheduleBacklinksDeferOneFrameAfterLoad();
          }
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    vaultRoot,
    selectedUri,
    fs,
    inboxEditorRef,
    loadFullMarkdownIntoInboxEditor,
    scheduleBacklinksDeferOneFrameAfterLoad,
    setInboxContentByUri,
    setLastPersistedSnapshot,
  ]);
}
