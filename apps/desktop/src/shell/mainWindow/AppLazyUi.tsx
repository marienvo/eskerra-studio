/**
 * Lazy-loaded main-window UI (settings + palettes).
 *
 * - Only this file may `lazy(() => import(...))` the three components below.
 * - Do not add `shell/mainWindow/index.ts` or re-export lazy modules from a barrel.
 * - Consumers: `AppMainStage` (settings), `AppPaletteLayer` (palettes). Not `App.tsx`.
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
