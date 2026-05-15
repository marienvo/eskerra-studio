import {useCallback, useMemo, useRef, useState, type MutableRefObject} from 'react';

import type {EditorWorkspaceTab} from '../lib/editorWorkspaceTabs';
import {
  hasReopenableClosedEditorTab,
  type ClosedEditorTabRecord,
} from '../lib/editorClosedTabStack';

type NoteRow = {lastModified: number | null; name: string; uri: string};

type UseEditorTabsStateOptions = {
  vaultRoot: string | null;
  notes: readonly NoteRow[];
};

export type UseEditorTabsStateResult = {
  editorWorkspaceTabs: EditorWorkspaceTab[];
  setEditorWorkspaceTabs: (next: EditorWorkspaceTab[]) => void;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabId: string | null;
  setActiveEditorTabId: (next: string | null) => void;
  activeEditorTabIdRef: MutableRefObject<string | null>;
  editorClosedTabsStackRef: MutableRefObject<ClosedEditorTabRecord[]>;
  bumpEditorClosedStack: () => void;
  canReopenClosedEditorTab: boolean;
};

export function useEditorTabsState(
  options: UseEditorTabsStateOptions,
): UseEditorTabsStateResult {
  const {vaultRoot, notes} = options;
  const [editorWorkspaceTabs, setEditorWorkspaceTabsState] = useState<EditorWorkspaceTab[]>([]);
  const [activeEditorTabId, setActiveEditorTabIdState] = useState<string | null>(null);
  const [editorClosedStackVersion, setEditorClosedStackVersion] = useState(0);
  const [editorClosedTabsStackSnapshot, setEditorClosedTabsStackSnapshot] = useState<
    ClosedEditorTabRecord[]
  >([]);
  const editorWorkspaceTabsRef = useRef<EditorWorkspaceTab[]>([]);
  const activeEditorTabIdRef = useRef<string | null>(null);
  const editorClosedTabsStackRef = useRef<ClosedEditorTabRecord[]>([]);

  const setEditorWorkspaceTabs = useCallback((next: EditorWorkspaceTab[]) => {
    editorWorkspaceTabsRef.current = next;
    setEditorWorkspaceTabsState(next);
  }, []);

  const setActiveEditorTabId = useCallback((next: string | null) => {
    activeEditorTabIdRef.current = next;
    setActiveEditorTabIdState(next);
  }, []);

  const bumpEditorClosedStack = useCallback(() => {
    setEditorClosedStackVersion(v => v + 1);
    setEditorClosedTabsStackSnapshot([...editorClosedTabsStackRef.current]);
  }, []);

  const canReopenClosedEditorTab = useMemo(() => {
    if (!vaultRoot) {
      return false;
    }
    const noteSet = new Set(notes.map(n => n.uri.replace(/\\/g, '/')));
    return hasReopenableClosedEditorTab(editorClosedTabsStackSnapshot, vaultRoot, noteSet);
  }, [vaultRoot, notes, editorClosedStackVersion, editorClosedTabsStackSnapshot]);

  return {
    editorWorkspaceTabs,
    setEditorWorkspaceTabs,
    editorWorkspaceTabsRef,
    activeEditorTabId,
    setActiveEditorTabId,
    activeEditorTabIdRef,
    editorClosedTabsStackRef,
    bumpEditorClosedStack,
    canReopenClosedEditorTab,
  };
}
