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
