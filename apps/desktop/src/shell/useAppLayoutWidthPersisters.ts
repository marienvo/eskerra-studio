import {useCallback, type Dispatch, type SetStateAction} from 'react';

import {
  saveStoredLayouts,
  type StoredLayouts,
} from '../lib/layout/layoutStore';

export function useAppLayoutWidthPersisters(
  setLayouts: Dispatch<SetStateAction<StoredLayouts>>,
) {
  const persistMainLeftWidthPx = useCallback((leftWidthPx: number) => {
    setLayouts(prev => {
      const next = {
        ...prev,
        inbox: {leftWidthPx},
        podcastsMain: {leftWidthPx},
      };
      void saveStoredLayouts(next);
      return next;
    });
  }, [setLayouts]);

  const persistVaultEpisodesStackTopHeightPx = useCallback(
    (topHeightPx: number) => {
      setLayouts(prev => {
        const next = {...prev, vaultEpisodesStack: {topHeightPx}};
        void saveStoredLayouts(next);
        return next;
      });
    },
    [setLayouts],
  );

  const persistNotificationsInboxStackTopHeightPx = useCallback(
    (topHeightPx: number) => {
      setLayouts(prev => {
        const next = {...prev, notificationsInboxStack: {topHeightPx}};
        void saveStoredLayouts(next);
        return next;
      });
    },
    [setLayouts],
  );

  const persistNotificationsWidthPx = useCallback(
    (widthPx: number) => {
      setLayouts(prev => {
        const next = {...prev, notifications: {widthPx}};
        void saveStoredLayouts(next);
        return next;
      });
    },
    [setLayouts],
  );

  return {
    persistMainLeftWidthPx,
    persistVaultEpisodesStackTopHeightPx,
    persistNotificationsInboxStackTopHeightPx,
    persistNotificationsWidthPx,
  };
}
