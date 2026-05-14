import type {StoredEditorWorkspaceTab} from '../mainWindowUiStore';

function firstHubUriInStoredTab(
  t: StoredEditorWorkspaceTab,
  hubSet: Set<string>,
): string | null {
  const idx =
    typeof t.index === 'number' && Number.isFinite(t.index)
      ? Math.floor(t.index)
      : 0;
  const cur = idx >= 0 && idx < t.entries.length ? t.entries[idx] : null;
  if (cur) {
    const n = cur.replace(/\\/g, '/');
    if (hubSet.has(n)) {
      return n;
    }
  }
  for (const e of t.entries) {
    const n = e.replace(/\\/g, '/');
    if (hubSet.has(n)) {
      return n;
    }
  }
  return null;
}

function firstHubInOpenTabUris(
  ots: readonly string[],
  hubSet: Set<string>,
): string | null {
  for (const u of ots) {
    if (typeof u !== 'string') {
      continue;
    }
    const n = u.trim().replace(/\\/g, '/');
    if (hubSet.has(n)) {
      return n;
    }
  }
  return null;
}

/**
 * When legacy flat inbox tabs had no per-hub map, choose which hub URI owns that snapshot.
 */
export function pickDefaultActiveTodayHubUri(options: {
  hubUris: readonly string[];
  selectedUri: string | null | undefined;
  editorWorkspaceTabs?: readonly StoredEditorWorkspaceTab[] | null;
  openTabUris?: readonly string[] | null;
}): string | null {
  const hubs = options.hubUris;
  if (hubs.length === 0) {
    return null;
  }
  const hubSet = new Set(hubs);
  const sel = options.selectedUri?.replace(/\\/g, '/').trim();
  if (sel && hubSet.has(sel)) {
    return sel;
  }
  const tabs = options.editorWorkspaceTabs;
  if (tabs && tabs.length > 0) {
    for (const t of tabs) {
      const hit = firstHubUriInStoredTab(t, hubSet);
      if (hit) {
        return hit;
      }
    }
  }
  const ots = options.openTabUris;
  if (ots) {
    const hit = firstHubInOpenTabUris(ots, hubSet);
    if (hit) {
      return hit;
    }
  }
  return hubs[0] ?? null;
}
