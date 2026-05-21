import {useCallback, useMemo, useState} from 'react';

import {DEFAULT_MAIN_WINDOW_PANE_VISIBILITY} from '../lib/mainWindowUiStore';

export type PaneVisibility = {
  vault: boolean;
  episodes: boolean;
  inbox: boolean;
  notifications: boolean;
};

const DEFAULT_PANE_VISIBILITY: PaneVisibility = {
  vault: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.vaultPaneVisible,
  episodes: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.episodesPaneVisible,
  inbox: DEFAULT_MAIN_WINDOW_PANE_VISIBILITY.inboxPaneVisible,
  notifications: true,
};

export type PaneVisibilityController = {
  visibility: PaneVisibility;
  setVisibility: (partial: Partial<PaneVisibility>) => void;
  togglePane: (key: keyof PaneVisibility) => void;
};

export function usePaneVisibility(): PaneVisibilityController {
  const [visibility, setRaw] = useState<PaneVisibility>(DEFAULT_PANE_VISIBILITY);
  const setVisibility = useCallback((partial: Partial<PaneVisibility>) => {
    setRaw(prev => ({...prev, ...partial}));
  }, []);
  const togglePane = useCallback((key: keyof PaneVisibility) => {
    setRaw(prev => ({...prev, [key]: !prev[key]}));
  }, []);
  return useMemo(
    () => ({visibility, setVisibility, togglePane}),
    [visibility, setVisibility, togglePane],
  );
}
