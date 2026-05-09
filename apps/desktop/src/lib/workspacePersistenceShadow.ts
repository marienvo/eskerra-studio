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

// ---------------------------------------------------------------------------
// Known timing / ordering divergences (DEV-only noise suppression)
// ---------------------------------------------------------------------------

export type PersistenceTimingDivergenceFilterArgs = {
  diff: string;
  activeHub: string | null;
  runtimeActiveHub: string | null;
  projectionActiveHub: string | null;
  restoredActiveHub: string | null;
  modelHubKeys: ReadonlySet<string>;
  legacyHubKeys: ReadonlySet<string>;
  hasPendingProjectionHubs: boolean;
};

export type PersistenceTimingDivergenceContext = Omit<
  PersistenceTimingDivergenceFilterArgs,
  'diff'
>;

export function diffIsForHub(diff: string, hub: string | null): boolean {
  return hub != null && diff.startsWith(`hub ${hub} `);
}

function isExtraModelHubPresenceDivergence(
  diff: string,
  modelHubKeys: ReadonlySet<string>,
  legacyHubKeys: ReadonlySet<string>,
): boolean {
  if (!diff.includes('presence model=yes runtime=no')) {
    return false;
  }
  for (const h of modelHubKeys) {
    if (!legacyHubKeys.has(h) && diffIsForHub(diff, h)) {
      return true;
    }
  }
  return false;
}

export function isKnownPersistenceTimingDivergence(
  args: PersistenceTimingDivergenceFilterArgs,
): boolean {
  const {
    diff,
    activeHub,
    runtimeActiveHub,
    projectionActiveHub,
    restoredActiveHub,
    modelHubKeys,
    legacyHubKeys,
    hasPendingProjectionHubs,
  } = args;
  if (isExtraModelHubPresenceDivergence(diff, modelHubKeys, legacyHubKeys)) {
    return true;
  }
  if (hasPendingProjectionHubs && diff.includes('presence model=no runtime=yes')) {
    return true;
  }
  if (legacyHubKeys.size === 0 && diff.includes('presence model=yes runtime=no')) {
    return true;
  }
  const activeHubMatch =
    diffIsForHub(diff, activeHub)
    || diffIsForHub(diff, runtimeActiveHub)
    || diffIsForHub(diff, projectionActiveHub)
    || diffIsForHub(diff, restoredActiveHub);
  if (diff.includes('presence model=yes runtime=no') && activeHubMatch) {
    return true;
  }
  if (
    diff.startsWith('activeTodayHubUri ')
    && (projectionActiveHub === null || runtimeActiveHub === null)
  ) {
    return true;
  }
  const isTabTimingDiff =
    activeHubMatch
    && (
      diff.includes('editorWorkspaceTabs')
      || diff.includes('activeEditorTabId')
      || diff.includes('homeHistory')
    );
  if (!isTabTimingDiff) {
    return false;
  }
  return [activeHub, runtimeActiveHub, projectionActiveHub, restoredActiveHub].some(
    hub => hub != null && modelHubKeys.has(hub) && legacyHubKeys.has(hub),
  );
}

export function filterPersistenceDivergenceDiffsExcludingKnownTiming(
  diffs: readonly string[],
  context: PersistenceTimingDivergenceContext,
): string[] {
  return diffs.filter(
    diff =>
      !isKnownPersistenceTimingDivergence({
        ...context,
        diff,
      }),
  );
}
