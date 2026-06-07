//! `~/.config/eskerra/reminderd.json` — the app→daemon config. Shape is LOCKED
//! in [ADR 003](../../../specs/adrs/003-adr-reminder-daemon.md) §5; changing a
//! field requires updating the ADR in the same PR.
//!
//! Parsing is fail-safe: a malformed / version-mismatched / invalid-field file
//! yields a [`ConfigError`] the daemon turns into "keep last-known-good"
//! behavior (see `daemon`), never a crash or action on partial data.

use eskerra_reminder_core::DefaultTime;
use serde::Deserialize;

/// Config schema version the daemon understands. Bump on any breaking change;
/// unknown versions fail safe (treated like a parse error → last-known-good).
pub const CONFIG_SCHEMA_VERSION: u32 = 1;

/// Default OS-notification lead when the config omits `leadMinutes`.
pub const DEFAULT_LEAD_MINUTES: u32 = 5;

/// Parsed, validated config. Constructed only via [`ReminderdConfig::from_json`]
/// so every field is already range-checked (e.g. the time string parsed into a
/// [`DefaultTime`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderdConfig {
    /// Absolute path of the active vault, or `None` = no active vault (idle).
    pub vault_root: Option<String>,
    /// Hash used to key the per-vault index file.
    pub vault_hash: Option<String>,
    /// Local default time applied to date-only `@YYYY-MM-DD` tokens.
    pub date_only_default_time: DefaultTime,
    /// OS-notification lead minutes; `fireAt = dueAt - leadMinutes`.
    pub lead_minutes: u32,
}

impl ReminderdConfig {
    /// True when this config names a vault (root present and non-empty). Both
    /// `vaultRoot` and `vaultHash` are required to act on a vault — a root
    /// without a hash cannot key an index, so it is treated as no vault.
    pub fn has_vault(&self) -> bool {
        self.vault_root.as_deref().is_some_and(|r| !r.is_empty())
            && self.vault_hash.as_deref().is_some_and(|h| !h.is_empty())
    }

    pub fn from_json(text: &str) -> Result<Self, ConfigError> {
        let raw: RawReminderdConfig =
            serde_json::from_str(text).map_err(|e| ConfigError::Parse(e.to_string()))?;
        if raw.schema_version != CONFIG_SCHEMA_VERSION {
            return Err(ConfigError::UnsupportedSchemaVersion(raw.schema_version));
        }
        let date_only_default_time = parse_hh_mm(&raw.date_only_default_time).ok_or_else(|| {
            ConfigError::InvalidField(format!(
                "dateOnlyDefaultTime is not a valid \"HH:MM\": {:?}",
                raw.date_only_default_time
            ))
        })?;
        Ok(Self {
            vault_root: normalize_optional(raw.vault_root),
            vault_hash: normalize_optional(raw.vault_hash),
            date_only_default_time,
            lead_minutes: raw.lead_minutes,
        })
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.is_empty())
}

/// Parse `"HH:MM"` (24-hour, zero-padded or not) into a [`DefaultTime`].
fn parse_hh_mm(text: &str) -> Option<DefaultTime> {
    let (h, m) = text.split_once(':')?;
    let hour: u8 = h.parse().ok()?;
    let minute: u8 = m.parse().ok()?;
    DefaultTime::new(hour, minute)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReminderdConfig {
    schema_version: u32,
    #[serde(default)]
    vault_root: Option<String>,
    #[serde(default)]
    vault_hash: Option<String>,
    #[serde(default = "default_date_only_time")]
    date_only_default_time: String,
    #[serde(default = "default_lead_minutes")]
    lead_minutes: u32,
}

fn default_date_only_time() -> String {
    "09:00".to_string()
}

fn default_lead_minutes() -> u32 {
    DEFAULT_LEAD_MINUTES
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    Parse(String),
    UnsupportedSchemaVersion(u32),
    InvalidField(String),
}

impl ConfigError {
    /// Stable observability reason tag (ADR §10 `config_invalid` event).
    pub fn reason_tag(&self) -> &'static str {
        match self {
            ConfigError::Parse(_) => "parse",
            ConfigError::UnsupportedSchemaVersion(_) => "version",
            ConfigError::InvalidField(_) => "missing_field",
        }
    }
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Parse(d) => write!(f, "malformed reminderd.json: {d}"),
            ConfigError::UnsupportedSchemaVersion(v) => {
                write!(f, "unsupported reminderd.json schema version: {v}")
            }
            ConfigError::InvalidField(d) => write!(f, "invalid reminderd.json field: {d}"),
        }
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_config() {
        let cfg = ReminderdConfig::from_json(
            r#"{"schemaVersion":1,"vaultRoot":"/home/me/vault","vaultHash":"abc","dateOnlyDefaultTime":"08:30","leadMinutes":10}"#,
        )
        .unwrap();
        assert!(cfg.has_vault());
        assert_eq!(cfg.vault_root.as_deref(), Some("/home/me/vault"));
        assert_eq!(cfg.vault_hash.as_deref(), Some("abc"));
        assert_eq!(cfg.date_only_default_time, DefaultTime::new(8, 30).unwrap());
        assert_eq!(cfg.lead_minutes, 10);
    }

    #[test]
    fn applies_defaults_for_optional_fields() {
        let cfg = ReminderdConfig::from_json(r#"{"schemaVersion":1}"#).unwrap();
        assert!(!cfg.has_vault());
        assert_eq!(cfg.date_only_default_time, DefaultTime::DEFAULT_NINE_AM);
        assert_eq!(cfg.lead_minutes, DEFAULT_LEAD_MINUTES);
    }

    #[test]
    fn no_vault_when_root_present_but_hash_missing() {
        let cfg = ReminderdConfig::from_json(r#"{"schemaVersion":1,"vaultRoot":"/home/me/vault"}"#)
            .unwrap();
        assert!(
            !cfg.has_vault(),
            "a root without a hash cannot key an index"
        );
    }

    #[test]
    fn empty_strings_normalize_to_none() {
        let cfg =
            ReminderdConfig::from_json(r#"{"schemaVersion":1,"vaultRoot":"","vaultHash":""}"#)
                .unwrap();
        assert_eq!(cfg.vault_root, None);
        assert_eq!(cfg.vault_hash, None);
        assert!(!cfg.has_vault());
    }

    #[test]
    fn rejects_unknown_schema_version() {
        assert_eq!(
            ReminderdConfig::from_json(r#"{"schemaVersion":2}"#),
            Err(ConfigError::UnsupportedSchemaVersion(2))
        );
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(matches!(
            ReminderdConfig::from_json("not json"),
            Err(ConfigError::Parse(_))
        ));
    }

    #[test]
    fn rejects_invalid_time_field() {
        assert!(matches!(
            ReminderdConfig::from_json(r#"{"schemaVersion":1,"dateOnlyDefaultTime":"25:99"}"#),
            Err(ConfigError::InvalidField(_))
        ));
        assert!(matches!(
            ReminderdConfig::from_json(r#"{"schemaVersion":1,"dateOnlyDefaultTime":"nope"}"#),
            Err(ConfigError::InvalidField(_))
        ));
    }

    #[test]
    fn reason_tags_are_stable() {
        assert_eq!(ConfigError::Parse(String::new()).reason_tag(), "parse");
        assert_eq!(
            ConfigError::UnsupportedSchemaVersion(2).reason_tag(),
            "version"
        );
        assert_eq!(
            ConfigError::InvalidField(String::new()).reason_tag(),
            "missing_field"
        );
    }
}
