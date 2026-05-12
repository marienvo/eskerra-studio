import {invoke} from '@tauri-apps/api/core';

// Mirrors vault_git_sync::status::GitStatusUnsafeState
// Rust: #[serde(rename_all = "camelCase")] unit enum → serialized as string
export type GitStatusUnsafeState =
  | 'detachedHead'
  | 'merge'
  | 'rebase'
  | 'cherryPick'
  | 'revert'
  | 'bisect'
  | 'indexLock';

// Mirrors vault_git_sync::status::GitStatusResult
// Rust: #[serde(rename_all = "camelCase")]
export interface GitStatusResult {
  branch: string | null;
  expectedBranch: string;
  hasUncommittedChanges: boolean;
  hasStagedChanges: boolean;
  hasUntrackedFiles: boolean;
  ahead: number;
  behind: number;
  remoteRefAvailable: boolean;
  unsafeState: GitStatusUnsafeState | null;
  isWrongBranch: boolean;
}

// Mirrors vault_git_sync::config::SyncConfig
// Rust: #[serde(rename_all = "camelCase")]
export interface SyncConfig {
  remote: string;
  branch: string;
  include: string[];
  exclude: string[];
  backupDirectory: string;
  conflictPolicies: ConflictPolicy[];
  markdownConflictCallout: MarkdownCalloutConfig;
  commitMessageTemplate: string;
  hostLabel: string | null;
  backupLocalSubdir: string;
  backupRemoteSubdir: string;
  timeouts: SyncTimeouts;
  allowCreateBackupDirectory: boolean;
  skipCommitHooks: boolean;
}

export interface ConflictPolicy {
  glob: string;
  strategy: ConflictStrategy;
}

export type ConflictStrategy = 'preferLocal' | 'preferRemote' | 'manual';

export interface MarkdownCalloutConfig {
  enabled: boolean;
  calloutKind: string;
  template: string;
}

export interface SyncTimeouts {
  fetchSecs: number;
  pushSecs: number;
  mergeSecs: number;
}

// Mirrors vault_git_sync::stage_plan::StagePlan
// Rust: #[serde(rename_all = "camelCase")]
export interface StagePlan {
  includedPaths: StagePlanEntry[];
  excludedPaths: StagePlanEntry[];
  unsupportedPaths: StagePlanEntry[];
}

export interface StageApplyResult {
  stagedPaths: StagePlanEntry[];
  excludedPaths: StagePlanEntry[];
  unsupportedPaths: StagePlanEntry[];
  mutated: boolean;
}

export interface StagePlanEntry {
  path: string;
  change: StagePlanChange;
  reason: StagePlanReason;
}

export type StagePlanChange =
  | 'modifiedTracked'
  | 'addedUntracked'
  | 'deletedTracked'
  | 'staged'
  | 'unsupported';

export type StagePlanReason =
  | 'included'
  | 'excludedByConfig'
  | 'excludedGitDirectory'
  | 'includeNotMatched'
  | 'unsupportedStatus';

// Mirrors vault_git_sync::local_commit::{LocalCommitResult, CommitInfo}
// Rust: #[serde(rename_all = "camelCase")]
export interface LocalCommitResult {
  stageResult: StageApplyResult;
  commit: CommitInfo | null;
  mutated: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
}

// Mirrors vault_git_sync::sync_run::SyncRunResult
// Rust: #[serde(rename_all = "camelCase")]
export interface SyncRunResult {
  localCommit: LocalCommitResult;
  preMergeSha: string | null;
  pushed: boolean;
  snapshotBranch: string | null;
  finalHeadSha: string | null;
}

// Mirrors vault_git_sync::errors::SyncError
// Rust: #[serde(tag = "type", rename_all = "camelCase")]
export type SyncError =
  | {type: 'notGitRepository'}
  | {type: 'detachedHead'}
  | {type: 'wrongBranch'; expected: string; actual: string}
  | {type: 'remoteMissing'; remote: string}
  | {type: 'remoteBranchMissing'; remote: string; branch: string}
  | {type: 'unsafeGitState'; kind: string}
  | {type: 'fetchFailed'; stderr: string}
  | {
      type: 'mergeFailed';
      stderr: string;
      snapshotBranch: string | null;
      preMergeSha: string | null;
    }
  | {type: 'conflictResolutionFailed'; unresolved: string[]; manual: string[]}
  | {type: 'pushRejected'; stderr: string}
  | {type: 'authenticationFailed'; stderr: string}
  | {type: 'lockAlreadyHeld'}
  | {type: 'invalidConfig'; reason: string}
  | {type: 'unsupportedStagePlan'; paths: string[]}
  | {type: 'gitCommandFailed'; command: string; exitCode: number | null; stderr: string}
  | {type: 'timeout'; step: string; secs: number};

export async function getVaultGitStatus(input: {
  vaultPath: string;
  remote: string;
  branch: string;
}): Promise<GitStatusResult> {
  return invoke<GitStatusResult>('vault_git_status', {
    vaultPath: input.vaultPath,
    remote: input.remote,
    branch: input.branch,
  });
}

export async function getVaultGitCurrentBranch(input: {
  vaultPath: string;
}): Promise<string | null> {
  return invoke<string | null>('vault_git_current_branch', {
    vaultPath: input.vaultPath,
  });
}

export async function getVaultGitStagePlan(input: {
  vaultPath: string;
  config: SyncConfig;
}): Promise<StagePlan> {
  return invoke<StagePlan>('vault_git_stage_plan', {
    vaultPath: input.vaultPath,
    config: input.config,
  });
}

export async function runVaultGitSync(input: {
  vaultPath: string;
  locksDir: string;
  config: SyncConfig;
}): Promise<SyncRunResult> {
  return invoke<SyncRunResult>('vault_git_sync_run', {
    vaultPath: input.vaultPath,
    locksDir: input.locksDir,
    config: input.config,
  });
}
