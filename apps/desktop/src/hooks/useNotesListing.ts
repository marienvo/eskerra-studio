import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type {VaultFilesystem} from '@eskerra/core';

import {listInboxNotes} from '../lib/vaultBootstrap';

export type NoteRow = {lastModified: number | null; name: string; uri: string};

export type UseNotesListingResult = {
  notes: NoteRow[];
  notesRef: MutableRefObject<NoteRow[]>;
  refreshNotes: (root: string) => Promise<void>;
  fsRefreshNonce: number;
  setFsRefreshNonce: Dispatch<SetStateAction<number>>;
  podcastFsNonce: number;
  setPodcastFsNonce: Dispatch<SetStateAction<number>>;
  vaultTreeSelectionClearNonce: number;
  setVaultTreeSelectionClearNonce: Dispatch<SetStateAction<number>>;
};

export function useNotesListing(options: {
  fs: VaultFilesystem;
}): UseNotesListingResult {
  const {fs} = options;
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const notesRef = useRef<NoteRow[]>([]);
  const [fsRefreshNonce, setFsRefreshNonce] = useState(0);
  const [podcastFsNonce, setPodcastFsNonce] = useState(0);
  const [vaultTreeSelectionClearNonce, setVaultTreeSelectionClearNonce] = useState(0);
  const notesListingGenerationRef = useRef(0);

  useLayoutEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const refreshNotes = useCallback(
    async (root: string) => {
      const gen = ++notesListingGenerationRef.current;
      const list = await listInboxNotes(root, fs);
      if (gen !== notesListingGenerationRef.current) {
        return;
      }
      setNotes(list);
    },
    [fs],
  );

  return {
    notes,
    notesRef,
    refreshNotes,
    fsRefreshNonce,
    setFsRefreshNonce,
    podcastFsNonce,
    setPodcastFsNonce,
    vaultTreeSelectionClearNonce,
    setVaultTreeSelectionClearNonce,
  };
}
