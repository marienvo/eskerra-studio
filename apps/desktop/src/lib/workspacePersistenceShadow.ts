/**
 * Verification-only: compare model-derived persistence against the runtime persistence payload.
 *
 * Does not affect production persistence. Only called in DEV/test mode.
 */
import {normalizeWorkspaceUri, sortedNormalizedHubs} from './workspaceModel';
import type {
  SerializedWorkspacePersistence,
  TodayHubWorkspaceSnapshotPersisted,
} from './workspaceModel/persistence';

type LooseStoredTab = {id: string; entries: string[]; index: number};

export type RuntimePersistencePayload = {
  activeTodayHubUri: string | null;
  todayHubWorkspaces: Record<
    string,
    {
      editorWorkspaceTabs: readonly LooseStoredTab[];
      activeEditorTabId?: string | null;
      homeHistory?: {entries: string[]; index: number} | null;
    }
  >;
};

function normalizeTabId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

function tabCurrentUri(tab: LooseStoredTab): string {
  const {entries, index} = tab;
  const clamped = index < 0 || index >= entries.length ? entries.length - 1 : index;
  return entries[clamped] ?? '';
}

function formatTabs(tabs: readonly LooseStoredTab[]): string {
  return tabs.map(t => `${t.id}:${tabCurrentUri(t)}`).join(',');
}

function formatHistory(
  h: {entries: string[]; index: number} | null | undefined,
): string {
  if (h == null) return 'null';
  return `[${h.entries.join('|')}]@${h.index}`;
}

type LooseSnap = RuntimePersistencePayload['todayHubWorkspaces'][string];

function describeHubDivergence(
  hub: string,
  model: TodayHubWorkspaceSnapshotPersisted | undefined,
  runtime: LooseSnap | undefined,
): string[] {
  const out: string[] = [];
  if (!model || !runtime) {
    out.push(
      `hub ${hub} presence model=${model ? 'yes' : 'no'} runtime=${runtime ? 'yes' : 'no'}`,
    );
    return out;
  }

  const mt = formatTabs(model.editorWorkspaceTabs);
  const rt = formatTabs(runtime.editorWorkspaceTabs);
  if (mt !== rt) {
    out.push(`hub ${hub} editorWorkspaceTabs model=[${mt}] runtime=[${rt}]`);
  }

  const ma = normalizeTabId(model.activeEditorTabId);
  const ra = normalizeTabId(runtime.activeEditorTabId);
  if (ma !== ra) {
    out.push(
      `hub ${hub} activeEditorTabId model=${ma ?? 'null'} runtime=${ra ?? 'null'}`,
    );
  }

  const mh = formatHistory(model.homeHistory);
  const rh = formatHistory(runtime.homeHistory);
  if (mh !== rh) {
    out.push(`hub ${hub} homeHistory model=${mh} runtime=${rh}`);
  }

  return out;
}

export function describeWorkspacePersistenceDivergence(
  modelDerived: SerializedWorkspacePersistence,
  runtime: RuntimePersistencePayload,
): string[] {
  const out: string[] = [];

  const ma = modelDerived.activeTodayHubUri
    ? normalizeWorkspaceUri(modelDerived.activeTodayHubUri)
    : null;
  const ra = runtime.activeTodayHubUri
    ? normalizeWorkspaceUri(runtime.activeTodayHubUri)
    : null;
  if (ma !== ra) {
    out.push(`activeTodayHubUri model=${ma ?? 'null'} runtime=${ra ?? 'null'}`);
  }

  const allHubs = sortedNormalizedHubs([
    ...Object.keys(modelDerived.todayHubWorkspaces),
    ...Object.keys(runtime.todayHubWorkspaces),
  ]);
  for (const hub of allHubs) {
    out.push(
      ...describeHubDivergence(
        hub,
        modelDerived.todayHubWorkspaces[hub],
        runtime.todayHubWorkspaces[hub],
      ),
    );
  }

  return out;
}
