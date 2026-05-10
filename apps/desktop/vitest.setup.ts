import '@testing-library/react';
import {cleanup} from '@testing-library/react';
import {afterEach, beforeEach, vi} from 'vitest';

import {__resetForTests as resetArtworkCacheDesktop} from './src/lib/podcasts/artworkCacheDesktop';
import {__resetForTests as resetCleanNoteMarkdown} from './src/lib/cleanNoteMarkdown';
import {__resetForTests as resetEditorWorkspaceTabs} from './src/lib/editorWorkspaceTabs';
import {__resetForTests as resetHtmlClipboardToMarkdown} from './src/lib/htmlClipboardToMarkdown';
import {__resetForTests as resetTableShellStaticPreviewStore} from './src/editor/noteEditor/eskerraTableV1/tableShellStaticPreviewStore';
import {__resetDesktopMediaSessionForTests} from './src/lib/desktopMediaSession';

/**
 * Do not import modules here that load `@tauri-apps/*` at module scope — Vitest runs `setupFiles`
 * before test files, so those imports bind the real Tauri client and break `vi.mock('@tauri-apps/...')`.
 * Resets for Tauri-backed caches live on `__resetForTests` exports; call them from tests that opt in.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();

  resetArtworkCacheDesktop();
  resetCleanNoteMarkdown();
  resetEditorWorkspaceTabs();
  resetHtmlClipboardToMarkdown();
  resetTableShellStaticPreviewStore();
  __resetDesktopMediaSessionForTests();
});

beforeEach(() => {
  document.cookie
    .split(';')
    .map(p => p.split('=')[0]!.trim())
    .filter(Boolean)
    .forEach(name => {
      document.cookie = `${name}=; Max-Age=0; path=/`;
    });
});
