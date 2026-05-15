import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

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
  setEditorWorkspaceTabs: Dispatch<SetStateAction<EditorWorkspaceTab[]>>;
  editorWorkspaceTabsRef: MutableRefObject<EditorWorkspaceTab[]>;
  activeEditorTabId: string | null;
  setActiveEditorTabId: Dispatch<SetStateAction<string | null>>;
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
  const [editorClosedTabsStackSnapshot, setEditorClosedTabsStackSnapshot] = useState<
    ClosedEditorTabRecord[]
  >([]);
  const editorWorkspaceTabsRef = useRef<EditorWorkspaceTab[]>([]);
  const activeEditorTabIdRef = useRef<string | null>(null);
  const editorClosedTabsStackRef = useRef<ClosedEditorTabRecord[]>([]);

  const setEditorWorkspaceTabs = useCallback((next: SetStateAction<EditorWorkspaceTab[]>) => {
    setEditorWorkspaceTabsState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      editorWorkspaceTabsRef.current = resolved;
      return resolved;
    });
  }, []);

  const setActiveEditorTabId = useCallback((next: SetStateAction<string | null>) => {
    setActiveEditorTabIdState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      activeEditorTabIdRef.current = resolved;
      return resolved;
    });
  }, []);

  const bumpEditorClosedStack = useCallback(() => {
    setEditorClosedTabsStackSnapshot([...editorClosedTabsStackRef.current]);
  }, []);

  const canReopenClosedEditorTab = useMemo(() => {
    if (!vaultRoot) {
      return false;
    }
    const noteSet = new Set(notes.map(n => n.uri.replace(/\\/g, '/')));
    return hasReopenableClosedEditorTab(editorClosedTabsStackSnapshot, vaultRoot, noteSet);
  }, [vaultRoot, notes, editorClosedTabsStackSnapshot]);

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
