use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncError {
    NotGitRepository,
    DetachedHead,
    WrongBranch {
        expected: String,
        actual: String,
    },
    RemoteMissing {
        remote: String,
    },
    RemoteBranchMissing {
        remote: String,
        branch: String,
    },
    UnsafeGitState {
        kind: UnsafeKind,
    },
    FetchFailed {
        stderr: String,
    },
    MergeFailed {
        stderr: String,
        snapshot_branch: Option<String>,
        pre_merge_sha: Option<String>,
    },
    ConflictResolutionFailed {
        unresolved: Vec<String>,
        manual: Vec<String>,
    },
    PushRejected {
        stderr: String,
    },
    /// Best-effort: detected from stderr patterns on fetch/push. May fall through to
    /// FetchFailed / PushRejected / GitCommandFailed for unrecognized auth errors.
    AuthenticationFailed {
        stderr: String,
    },
    LockAlreadyHeld,
    InvalidConfig {
        reason: String,
    },
    GitCommandFailed {
        command: String,
        exit_code: Option<i32>,
        stderr: String,
    },
    Timeout {
        step: String,
        secs: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnsafeKind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Bisect,
    IndexLock,
    IndexNotClean,
}
