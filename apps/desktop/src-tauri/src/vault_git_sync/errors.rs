use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
    UnsupportedStagePlan {
        paths: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn ser(v: &SyncError) -> Value {
        serde_json::to_value(v).unwrap()
    }

    // Unit variants — only the "type" tag is present.
    #[test]
    fn unit_variants_serialize_camel_type() {
        assert_eq!(
            ser(&SyncError::NotGitRepository),
            json!({"type": "notGitRepository"})
        );
        assert_eq!(
            ser(&SyncError::DetachedHead),
            json!({"type": "detachedHead"})
        );
        assert_eq!(
            ser(&SyncError::LockAlreadyHeld),
            json!({"type": "lockAlreadyHeld"})
        );
    }

    // Single-word fields — unaffected by camelCase but still explicit.
    #[test]
    fn wrong_branch_fields_are_camel() {
        let e = SyncError::WrongBranch {
            expected: "main".into(),
            actual: "feature".into(),
        };
        assert_eq!(
            ser(&e),
            json!({"type": "wrongBranch", "expected": "main", "actual": "feature"})
        );
    }

    #[test]
    fn remote_branch_missing_fields_are_camel() {
        let e = SyncError::RemoteBranchMissing {
            remote: "origin".into(),
            branch: "main".into(),
        };
        assert_eq!(
            ser(&e),
            json!({"type": "remoteBranchMissing", "remote": "origin", "branch": "main"})
        );
    }

    // Multi-word snake_case fields that require rename_all_fields to be camelCase.
    #[test]
    fn git_command_failed_exit_code_is_camel() {
        let e = SyncError::GitCommandFailed {
            command: "git fetch".into(),
            exit_code: Some(128),
            stderr: "fatal".into(),
        };
        let v = ser(&e);
        assert_eq!(v["type"], "gitCommandFailed");
        // Must be "exitCode", not "exit_code".
        assert_eq!(v["exitCode"], 128);
        assert!(
            v.get("exit_code").is_none(),
            "snake_case key must not appear"
        );
    }

    #[test]
    fn merge_failed_snake_fields_are_camel() {
        let e = SyncError::MergeFailed {
            stderr: "conflict".into(),
            snapshot_branch: Some("snap".into()),
            pre_merge_sha: Some("abc123".into()),
        };
        let v = ser(&e);
        assert_eq!(v["type"], "mergeFailed");
        // Must be camelCase.
        assert_eq!(v["snapshotBranch"], "snap");
        assert_eq!(v["preMergeSha"], "abc123");
        assert!(
            v.get("snapshot_branch").is_none(),
            "snake_case key must not appear"
        );
        assert!(
            v.get("pre_merge_sha").is_none(),
            "snake_case key must not appear"
        );
    }
}
