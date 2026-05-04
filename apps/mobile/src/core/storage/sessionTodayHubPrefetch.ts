import {
  startOfLocalWeekMonday,
  todayHubRowUriFromTodayNoteUri,
  trimTrailingSlashes,
} from '@eskerra/core';

import {loadPersistedActiveTodayHubUri} from '../../features/vault/storage/activeTodayHubStorage';

/**
 * SAF tree URIs (`.../tree/<docId>[/document/<docId>]`) and document URIs
 * (`.../document/<docId>`) share a `primary:...` document-id space. The persisted
 * Today hub URI is typically a plain document URI while the session baseUri is a
 * tree URI, so a naive prefix compare on the raw content:// strings reports false.
 * Extract and URL-decode the canonical document-id segments and compare those.
 */
function extractSafDocumentId(uri: string): string | null {
  const trimmed = uri.trim();
  const docMatch = trimmed.match(/\/document\/([^/?#]+)/);
  const treeMatch = trimmed.match(/\/tree\/([^/?#]+)/);
  const raw = docMatch?.[1] ?? treeMatch?.[1] ?? null;
  if (raw == null) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function vaultUriBelongsToBase(hubUri: string, baseUri: string): boolean {
  const hubId = extractSafDocumentId(hubUri);
  const baseId = extractSafDocumentId(baseUri);
  if (hubId != null && baseId != null) {
    const h = trimTrailingSlashes(hubId.replace(/\\/g, '/'));
    const b = trimTrailingSlashes(baseId.replace(/\\/g, '/'));
    if (h === b || h.startsWith(`${b}/`)) {
      return true;
    }
  }
  const hRaw = hubUri.replace(/\\/g, '/').trim();
  const bRaw = trimTrailingSlashes(baseUri.replace(/\\/g, '/'));
  return hRaw.startsWith(`${bRaw}/`) || hRaw === bRaw;
}

/**
 * URIs to prefetch during native `prepareEskerraSession` (Today intro + current week row).
 * Uses persisted hub when it belongs to this vault; week start uses default Monday (same as
 * empty frontmatter) so prefetch stays valid before settings are parsed.
 */
export async function resolveTodayHubPrefetchUrisForSession(
  baseUri: string,
): Promise<string[] | undefined> {
  const hub = await loadPersistedActiveTodayHubUri();
  if (!hub || !vaultUriBelongsToBase(hub, baseUri)) {
    return undefined;
  }
  /**
   * Best-effort current-week row for cold start (Monday-aligned; VaultScreen applies the hub's
   * `start` from frontmatter when syncing week navigation). Prefetch hits session cache on first read.
   */
  const ws = startOfLocalWeekMonday(new Date());
  return [hub, todayHubRowUriFromTodayNoteUri(hub, ws)];
}
