/**
 * Lazy-loaded main-window UI (settings + palettes). Keep eager imports out of App.tsx
 * and avoid barrel re-exports so these chunks stay on-demand.
 */
import {lazy} from 'react';

export const LazySettingsPage = lazy(() =>
  import('../../components/SettingsPage').then(m => ({default: m.SettingsPage})),
);

export const LazyQuickOpenNotePalette = lazy(() =>
  import('../../components/QuickOpenNotePalette').then(m => ({
    default: m.QuickOpenNotePalette,
  })),
);

export const LazyVaultSearchPalette = lazy(() =>
  import('../../components/VaultSearchPalette').then(m => ({
    default: m.VaultSearchPalette,
  })),
);

export const appLazyFallback = <div aria-busy="true" />;
