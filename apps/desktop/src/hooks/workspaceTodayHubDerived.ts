import {
  normalizeVaultBaseUri,
  sortedTodayHubNoteUrisFromRefs,
  trimTrailingSlashes,
  vaultUriIsTodayMarkdownFile,
  type VaultMarkdownRef,
} from '@eskerra/core';

import {editorOpenTabPillLabel} from '../lib/editorOpenTabPillLabel';
import {inboxEditorSliceToFullMarkdown} from '../lib/inboxYamlFrontmatterEditor';
import {
  createWorkspaceHomeState,
  type WorkspaceHomeState,
} from '../lib/workspaceHomeNavigation';
import type {TodayHubWorkspaceSnapshot} from '../lib/mainWindowUiStore';
import {parseTodayHubFrontmatter, type TodayHubSettings} from '../lib/todayHub';

/** True only when the selected URI is `Today.md` inside the active vault root and compose mode is off. */
export function deriveTodayHubShowCanvas(
  vaultRoot: string | null,
  selectedUri: string | null,
  composingNewEntry: boolean,
): boolean {
  if (!vaultRoot || !selectedUri || composingNewEntry) {
    return false;
  }
  const normRoot = trimTrailingSlashes(normalizeVaultBaseUri(vaultRoot).replace(/\\/g, '/'));
  const normSel = selectedUri.replace(/\\/g, '/');
  if (!normSel.startsWith(`${normRoot}/`)) {
    return false;
  }
  return vaultUriIsTodayMarkdownFile(normSel);
}

/**
 * Parse Today Hub settings from the current editor slice.
 *
 * Uses `inboxYamlFrontmatterInner` state (not only the ref) so the caller's
 * useMemo dependency array picks up frontmatter-only edits. Leading YAML comes
 * from the ref, updated with inner on disk sync.
 */
export function deriveTodayHubSettings(args: {
  showTodayHubCanvas: boolean;
  selectedUri: string | null;
  editorBody: string;
  composingNewEntry: boolean;
  inboxYamlFrontmatterInner: string | null;
  inboxEditorYamlLeadingBeforeFrontmatter: string;
}): TodayHubSettings | null {
  if (!args.showTodayHubCanvas || !args.selectedUri) {
    return null;
  }
  const full = inboxEditorSliceToFullMarkdown(
    args.editorBody,
    args.selectedUri,
    args.composingNewEntry,
    args.inboxYamlFrontmatterInner,
    args.inboxEditorYamlLeadingBeforeFrontmatter,
  );
  return parseTodayHubFrontmatter(full);
}

/** Ordered selector items for all `Today.md` hubs currently in the vault. */
export function deriveTodayHubSelectorItems(
  vaultMarkdownRefs: readonly VaultMarkdownRef[],
  notes: readonly {name: string; uri: string}[],
): Array<{todayNoteUri: string; label: string}> {
  const hubs = sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs);
  return hubs.map(todayNoteUri => ({
    todayNoteUri,
    label: editorOpenTabPillLabel(notes, todayNoteUri),
  }));
}

/** Hub workspace snapshots filtered to URIs that still exist as vault `Today.md` refs. */
export function deriveTodayHubWorkspacesPersistFiltered(
  vaultMarkdownRefs: readonly VaultMarkdownRef[],
  todayHubWorkspacesForSave: Record<string, TodayHubWorkspaceSnapshot>,
): Record<string, TodayHubWorkspaceSnapshot> {
  const hubs = new Set(sortedTodayHubNoteUrisFromRefs(vaultMarkdownRefs));
  const out: Record<string, TodayHubWorkspaceSnapshot> = {};
  for (const [k, v] of Object.entries(todayHubWorkspacesForSave)) {
    if (hubs.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

/** Adds `homeHistory` from runtime {@link WorkspaceHomeState} for JSON persistence. */
export function mergeHomeHistoryIntoHubSnapshotsForPersist(
  filtered: Record<string, TodayHubWorkspaceSnapshot>,
  homeStatesByHub: Record<string, WorkspaceHomeState>,
): Record<string, TodayHubWorkspaceSnapshot> {
  const out: Record<string, TodayHubWorkspaceSnapshot> = {};
  for (const [hub, snap] of Object.entries(filtered)) {
    const home = homeStatesByHub[hub] ?? createWorkspaceHomeState(hub);
    out[hub] = {
      ...snap,
      homeHistory: {
        entries: [...home.history.entries],
        index: home.history.index,
      },
    };
  }
  return out;
}
