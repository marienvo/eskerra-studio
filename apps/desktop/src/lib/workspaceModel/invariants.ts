import type {WorkspaceModel, WorkspaceState} from './types';
import {normalizeWorkspaceUri} from './types';

export type WorkspaceModelIssue = {
  code: string;
  message: string;
};

/**
 * Structural checks for a WorkspaceModel. Intended for tests and optional DEV asserts.
 */
export function validateWorkspaceModel(m: WorkspaceModel): WorkspaceModelIssue[] {
  const issues: WorkspaceModelIssue[] = [];
  const keys = Object.keys(m.workspaces);
  const hubSet = new Set(keys.map(normalizeWorkspaceUri));

  issues.push(...validateActiveHubConsistency(m, keys, hubSet));
  for (const hubKey of keys) {
    issues.push(...validateSingleWorkspace(hubKey, m.workspaces[hubKey]!));
  }

  return issues;
}

function validateActiveHubConsistency(
  m: WorkspaceModel,
  keys: string[],
  hubSet: Set<string>,
): WorkspaceModelIssue[] {
  const issues: WorkspaceModelIssue[] = [];
  if (m.activeHub == null) {
    if (keys.length > 0) {
      issues.push({
        code: 'activeHub_null_with_workspaces',
        message: 'activeHub is null but workspaces map is non-empty',
      });
    }
    return issues;
  }
  const ah = normalizeWorkspaceUri(m.activeHub);
  if (!hubSet.has(ah)) {
    issues.push({
      code: 'activeHub_missing_workspace',
      message: `activeHub ${ah} has no matching workspace entry`,
    });
  }
  return issues;
}

function validateSingleWorkspace(hubKey: string, ws: WorkspaceState): WorkspaceModelIssue[] {
  const issues: WorkspaceModelIssue[] = [];
  const hubNorm = normalizeWorkspaceUri(hubKey);

  if (hubKey !== hubNorm) {
    issues.push({
      code: 'workspace_key_not_normalized',
      message: `Workspace map key should be normalized: ${hubKey}`,
    });
  }

  const {homeHistory, tabs, active} = ws;
  if (homeHistory.entries.length === 0) {
    issues.push({code: 'home_history_empty', message: `Hub ${hubKey}: homeHistory.entries is empty`});
  } else if (normalizeWorkspaceUri(homeHistory.entries[0]!) !== hubNorm) {
    issues.push({
      code: 'home_root_mismatch',
      message: `Hub ${hubKey}: homeHistory.entries[0] must equal hub Today URI`,
    });
  }
  if (homeHistory.index < 0 || homeHistory.index >= homeHistory.entries.length) {
    issues.push({
      code: 'home_history_index_range',
      message: `Hub ${hubKey}: homeHistory.index out of range`,
    });
  }

  const seen = new Set<string>();
  for (const t of tabs) {
    if (seen.has(t.id)) {
      issues.push({code: 'duplicate_tab_id', message: `Hub ${hubKey}: duplicate tab id ${t.id}`});
    }
    seen.add(t.id);
    if (t.history.entries.length === 0) {
      issues.push({code: 'tab_history_empty', message: `Hub ${hubKey}: tab ${t.id} has empty history`});
    } else if (t.history.index < 0 || t.history.index >= t.history.entries.length) {
      issues.push({
        code: 'tab_history_index_range',
        message: `Hub ${hubKey}: tab ${t.id} history index out of range`,
      });
    }
  }

  if (active.kind === 'tab') {
    if (!tabs.some(t => t.id === active.id)) {
      issues.push({
        code: 'active_tab_missing',
        message: `Hub ${hubKey}: active tab id ${active.id} not found in tabs`,
      });
    }
  }

  return issues;
}
