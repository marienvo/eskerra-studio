use std::path::{Component, Path};

use glob::Pattern;
use serde::{Deserialize, Serialize};

use crate::vault_git_sync::errors::SyncError;

const MAX_TIMEOUT_SECS: u32 = 24 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub remote: String,
    pub branch: String,
    /// Vault-relative globs eligible for sync. Empty is invalid: a sync profile
    /// with no include rules is treated as misconfigured rather than "sync nothing".
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub backup_directory: String,
    pub conflict_policies: Vec<ConflictPolicy>,
    pub markdown_conflict_callout: MarkdownCalloutConfig,
    pub commit_message_template: String,
    pub host_label: Option<String>,
    pub backup_local_subdir: String,
    pub backup_remote_subdir: String,
    pub timeouts: SyncTimeouts,
    pub allow_create_backup_directory: bool,
    pub skip_commit_hooks: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPolicy {
    pub glob: String,
    pub strategy: ConflictStrategy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictStrategy {
    PreferLocal,
    PreferRemote,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownCalloutConfig {
    pub enabled: bool,
    pub callout_kind: String,
    pub template: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTimeouts {
    pub fetch_secs: u32,
    pub push_secs: u32,
    pub merge_secs: u32,
}

#[derive(Debug, Clone)]
pub struct CompiledSyncConfig {
    pub config: SyncConfig,
    pub include: CompiledGlobSet,
    pub exclude: CompiledGlobSet,
    pub conflict_policies: Vec<CompiledConflictPolicy>,
}

#[derive(Debug, Clone)]
pub struct CompiledConflictPolicy {
    pub glob: String,
    pub matcher: CompiledGlob,
    pub strategy: ConflictStrategy,
}

#[derive(Debug, Clone)]
pub struct CompiledGlobSet {
    globs: Vec<CompiledGlob>,
}

#[derive(Debug, Clone)]
pub struct CompiledGlob {
    source: String,
    segments: Vec<CompiledGlobSegment>,
}

#[derive(Debug, Clone)]
enum CompiledGlobSegment {
    Recursive,
    Pattern(Pattern),
}

impl SyncConfig {
    pub fn validate(&self) -> Result<(), SyncError> {
        self.compile().map(|_| ())
    }

    pub fn compile(&self) -> Result<CompiledSyncConfig, SyncError> {
        validate_non_empty("remote", &self.remote)?;
        validate_non_empty("branch", &self.branch)?;
        validate_non_empty_list("include", &self.include)?;
        validate_relative_non_empty("backup_directory", &self.backup_directory)?;
        validate_relative_non_empty("backup_local_subdir", &self.backup_local_subdir)?;
        validate_relative_non_empty("backup_remote_subdir", &self.backup_remote_subdir)?;
        validate_non_empty("commit_message_template", &self.commit_message_template)?;
        validate_timeout("fetch_secs", self.timeouts.fetch_secs)?;
        validate_timeout("push_secs", self.timeouts.push_secs)?;
        validate_timeout("merge_secs", self.timeouts.merge_secs)?;

        if let Some(host_label) = &self.host_label {
            validate_non_empty("host_label", host_label)?;
        }

        if self.markdown_conflict_callout.enabled {
            validate_non_empty(
                "markdown_conflict_callout.callout_kind",
                &self.markdown_conflict_callout.callout_kind,
            )?;
            validate_non_empty(
                "markdown_conflict_callout.template",
                &self.markdown_conflict_callout.template,
            )?;
        }

        let include = CompiledGlobSet::new("include", &self.include)?;
        let exclude = CompiledGlobSet::new("exclude", &self.exclude)?;
        let conflict_policies = self
            .conflict_policies
            .iter()
            .map(|policy| {
                validate_non_empty("conflict_policies.glob", &policy.glob)?;
                Ok(CompiledConflictPolicy {
                    glob: policy.glob.clone(),
                    matcher: CompiledGlob::new("conflict_policies.glob", &policy.glob)?,
                    strategy: policy.strategy.clone(),
                })
            })
            .collect::<Result<Vec<_>, SyncError>>()?;

        Ok(CompiledSyncConfig {
            config: self.clone(),
            include,
            exclude,
            conflict_policies,
        })
    }
}

impl CompiledSyncConfig {
    pub fn matches_include(&self, path: &str) -> bool {
        self.include.matches(path)
    }

    pub fn matches_exclude(&self, path: &str) -> bool {
        is_git_path(path) || self.exclude.matches(path)
    }
}

impl CompiledGlobSet {
    pub fn new(label: &str, globs: &[String]) -> Result<Self, SyncError> {
        let globs = globs
            .iter()
            .map(|glob| CompiledGlob::new(label, glob))
            .collect::<Result<Vec<_>, SyncError>>()?;
        Ok(Self { globs })
    }

    pub fn matches(&self, path: &str) -> bool {
        self.globs.iter().any(|glob| glob.matches(path))
    }

    pub fn is_empty(&self) -> bool {
        self.globs.is_empty()
    }
}

impl CompiledGlob {
    pub fn new(label: &str, glob: &str) -> Result<Self, SyncError> {
        validate_non_empty(label, glob)?;
        Pattern::new(glob).map_err(|err| invalid_config(format!("{label}: {err}")))?;
        let normalized = glob.replace('\\', "/");
        let segments = normalized
            .split('/')
            .map(|segment| {
                if segment == "**" {
                    Ok(CompiledGlobSegment::Recursive)
                } else {
                    Pattern::new(segment)
                        .map(CompiledGlobSegment::Pattern)
                        .map_err(|err| invalid_config(format!("{label}: {err}")))
                }
            })
            .collect::<Result<Vec<_>, SyncError>>()?;
        Ok(Self {
            source: glob.to_string(),
            segments,
        })
    }

    pub fn matches(&self, path: &str) -> bool {
        let normalized = path.replace('\\', "/");
        let path_segments = normalized
            .split('/')
            .filter(|segment| !segment.is_empty() && *segment != ".")
            .collect::<Vec<_>>();
        matches_segments(&self.segments, &path_segments)
    }

    pub fn source(&self) -> &str {
        &self.source
    }
}

fn matches_segments(pattern: &[CompiledGlobSegment], path: &[&str]) -> bool {
    if pattern.is_empty() {
        return path.is_empty();
    }

    match &pattern[0] {
        CompiledGlobSegment::Recursive => {
            matches_segments(&pattern[1..], path)
                || (!path.is_empty() && matches_segments(pattern, &path[1..]))
        }
        CompiledGlobSegment::Pattern(segment) => {
            !path.is_empty()
                && segment.matches(path[0])
                && matches_segments(&pattern[1..], &path[1..])
        }
    }
}

fn validate_non_empty(field: &str, value: &str) -> Result<(), SyncError> {
    if value.trim().is_empty() {
        return Err(invalid_config(format!("{field} must be non-empty")));
    }
    Ok(())
}

fn validate_non_empty_list(field: &str, value: &[String]) -> Result<(), SyncError> {
    if value.is_empty() {
        return Err(invalid_config(format!(
            "{field} must contain at least one glob"
        )));
    }
    Ok(())
}

fn validate_relative_non_empty(field: &str, value: &str) -> Result<(), SyncError> {
    validate_non_empty(field, value)?;
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(invalid_config(format!("{field} must be vault-relative")));
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(invalid_config(format!("{field} must be vault-relative")));
            }
        }
    }
    Ok(())
}

fn validate_timeout(field: &str, value: u32) -> Result<(), SyncError> {
    if value == 0 {
        return Err(invalid_config(format!("{field} must be greater than zero")));
    }
    if value > MAX_TIMEOUT_SECS {
        return Err(invalid_config(format!(
            "{field} must be no greater than {MAX_TIMEOUT_SECS}"
        )));
    }
    Ok(())
}

fn is_git_path(path: &str) -> bool {
    path == ".git" || path.starts_with(".git/")
}

fn invalid_config(reason: String) -> SyncError {
    SyncError::InvalidConfig { reason }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn valid_config() -> SyncConfig {
        SyncConfig {
            remote: "origin".into(),
            branch: "main".into(),
            include: vec!["**/*.md".into()],
            exclude: vec!["Scripts/**".into()],
            backup_directory: "_sync-backups".into(),
            conflict_policies: vec![ConflictPolicy {
                glob: "**/*.md".into(),
                strategy: ConflictStrategy::Manual,
            }],
            markdown_conflict_callout: MarkdownCalloutConfig {
                enabled: true,
                callout_kind: "warning".into(),
                template: "Conflict backup: [[{backup_path}]]".into(),
            },
            commit_message_template: "chore: sync {timestamp} {host}".into(),
            host_label: Some("laptop".into()),
            backup_local_subdir: "local".into(),
            backup_remote_subdir: "remote".into(),
            timeouts: SyncTimeouts {
                fetch_secs: 30,
                push_secs: 30,
                merge_secs: 30,
            },
            allow_create_backup_directory: false,
            skip_commit_hooks: true,
        }
    }

    #[test]
    fn valid_config_passes() {
        valid_config().validate().unwrap();
    }

    #[test]
    fn invalid_empty_remote_fails() {
        let mut config = valid_config();
        config.remote = " ".into();
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("remote")
        ));
    }

    #[test]
    fn invalid_empty_branch_fails() {
        let mut config = valid_config();
        config.branch.clear();
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("branch")
        ));
    }

    #[test]
    fn invalid_absolute_backup_directory_fails() {
        let mut config = valid_config();
        config.backup_directory = "/tmp/backups".into();
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("backup_directory")
        ));
    }

    #[test]
    fn invalid_glob_fails() {
        let mut config = valid_config();
        config.include = vec!["[".into()];
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("include")
        ));
    }

    #[test]
    fn invalid_empty_include_fails() {
        let mut config = valid_config();
        config.include.clear();
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("include")
        ));
    }

    #[test]
    fn invalid_conflict_policy_glob_fails() {
        let mut config = valid_config();
        config.conflict_policies[0].glob = "[".into();
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("conflict_policies.glob")
        ));
    }

    #[test]
    fn invalid_zero_timeout_fails() {
        let mut config = valid_config();
        config.timeouts.fetch_secs = 0;
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("fetch_secs")
        ));
    }

    #[test]
    fn enabled_markdown_callout_requires_template() {
        let mut config = valid_config();
        config.markdown_conflict_callout.template.clear();
        assert!(matches!(
            config.validate(),
            Err(SyncError::InvalidConfig { reason }) if reason.contains("template")
        ));
    }

    #[test]
    fn double_star_glob_matches_root_and_nested_paths() {
        let glob = CompiledGlob::new("include", "**/*.md").unwrap();
        assert!(glob.matches("root.md"));
        assert!(glob.matches("Folder/note.md"));
        assert!(!glob.matches("Folder/note.txt"));
    }

    #[test]
    fn root_glob_matches_only_root_level_markdown() {
        let glob = CompiledGlob::new("exclude", "*.md").unwrap();
        assert!(glob.matches("root.md"));
        assert!(!glob.matches("Folder/note.md"));
    }

    #[test]
    fn directory_double_star_glob_matches_nested_files() {
        let glob = CompiledGlob::new("exclude", "Scripts/**").unwrap();
        assert!(glob.matches("Scripts/build.sh"));
        assert!(glob.matches("Scripts/Nested/build.sh"));
        assert!(!glob.matches("Notes/Scripts/build.sh"));
    }
}
