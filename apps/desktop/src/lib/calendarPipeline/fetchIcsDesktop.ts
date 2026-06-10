import {invoke} from '@tauri-apps/api/core';

/**
 * Fetches ICS text via the Rust `fetch_ics` command (CORS-safe, off the renderer thread).
 * Mirrors the `desktopR2Transport` invoke style. Rejects on non-2xx / network errors.
 */
export function fetchIcsDesktop(url: string, timeoutMs?: number): Promise<string> {
  return invoke<string>('fetch_ics', {url, timeoutMs});
}
