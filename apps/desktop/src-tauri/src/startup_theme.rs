use std::{fs, path::Path};

use serde::Serialize;
use serde_json::Value;
use tauri::{path::BaseDirectory, Manager};

const STORE_PATH: &str = "eskerra-desktop.json";
const STORE_KEY_VAULT: &str = "vaultRoot";
const STORE_KEY_STARTUP_THEME: &str = "startupTheme";
const ESKERRA_DIR: &str = ".eskerra";
const SETTINGS_SHARED_FILE: &str = "settings-shared.json";
const THEMES_DIR: &str = "themes";
const DEFAULT_THEME_ID: &str = "eskerra-default";
const DEFAULT_THEME_MODE: &str = "auto";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupTheme {
    pub preference: ThemePreference,
    pub resolved_mode: String,
    pub theme: ThemeDefinition,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreference {
    pub theme_id: String,
    pub mode: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDefinition {
    pub id: String,
    pub name: String,
    pub source: String,
    pub light: ThemePaletteWrapper,
    pub dark: ThemePaletteWrapper,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ThemePaletteWrapper {
    pub palette: Vec<String>,
}

fn bundled_themes() -> Vec<ThemeDefinition> {
    vec![
        ThemeDefinition {
            id: "eskerra-default".into(),
            name: "Eskerra Default".into(),
            source: "bundled".into(),
            dark: palette(&["#031226", "#11538C", "#11A0D9", "#41CAD9", "#B3F2D5"]),
            light: palette(&["#F5F8FB", "#C8DAEA", "#8FBDE0", "#5FA6D1", "#E0F2E6"]),
            file_name: None,
        },
        ThemeDefinition {
            id: "ash".into(),
            name: "Ash".into(),
            source: "bundled".into(),
            dark: palette(&["#282828"]),
            light: palette(&["#E7E7E7"]),
            file_name: None,
        },
        ThemeDefinition {
            id: "blossom".into(),
            name: "Blossom".into(),
            source: "bundled".into(),
            dark: palette(&["#1A0A12", "#5C1F3A", "#C43F70", "#F07AAA"]),
            light: palette(&["#FFF5F8", "#FAD6E4", "#F0A8C4", "#F8E1EE"]),
            file_name: None,
        },
        ThemeDefinition {
            id: "ember".into(),
            name: "Ember".into(),
            source: "bundled".into(),
            dark: palette(&["#150900", "#7A2800", "#CC5500", "#F0921E", "#F5D090"]),
            light: palette(&["#FBF5EA", "#F8E4C0", "#ECC47E", "#F8E4C0", "#F0D5A5"]),
            file_name: None,
        },
    ]
}

fn palette(colors: &[&str]) -> ThemePaletteWrapper {
    ThemePaletteWrapper {
        palette: colors.iter().map(|c| (*c).to_string()).collect(),
    }
}

fn default_theme() -> ThemeDefinition {
    bundled_themes()
        .into_iter()
        .find(|theme| theme.id == DEFAULT_THEME_ID)
        .expect("default bundled theme exists")
}

pub fn default_startup_theme() -> StartupTheme {
    let preference = ThemePreference {
        theme_id: DEFAULT_THEME_ID.into(),
        mode: DEFAULT_THEME_MODE.into(),
    };
    StartupTheme {
        preference,
        resolved_mode: "dark".into(),
        theme: default_theme(),
    }
}

pub fn load_startup_theme<R: tauri::Runtime>(app: &tauri::App<R>) -> StartupTheme {
    let store_path = match app.path().resolve(STORE_PATH, BaseDirectory::AppData) {
        Ok(path) => path,
        Err(_) => return default_startup_theme(),
    };
    let store = read_json_file(&store_path).unwrap_or(Value::Null);
    let cached = parse_cached_startup_theme(store.get(STORE_KEY_STARTUP_THEME));
    let vault_root = store
        .get(STORE_KEY_VAULT)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let Some(vault_root) = vault_root else {
        return cached.unwrap_or_else(default_startup_theme);
    };

    let settings = read_json_file(
        &Path::new(vault_root)
            .join(ESKERRA_DIR)
            .join(SETTINGS_SHARED_FILE),
    )
    .ok();
    if let Some(preference) = settings
        .as_ref()
        .and_then(|value| parse_theme_preference(value.get("themePreference")))
    {
        return resolve_theme_for_preference(vault_root, preference, cached);
    }

    cached.unwrap_or_else(default_startup_theme)
}

fn resolve_theme_for_preference(
    vault_root: &str,
    preference: ThemePreference,
    cached: Option<StartupTheme>,
) -> StartupTheme {
    let resolved_mode = resolve_mode(&preference.mode);
    let bundled = bundled_themes()
        .into_iter()
        .find(|theme| theme.id == preference.theme_id);
    let theme = bundled
        .or_else(|| read_vault_theme(vault_root, &preference.theme_id).ok())
        .or_else(|| {
            cached.and_then(|cached| {
                if cached.theme.id == preference.theme_id {
                    Some(cached.theme)
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(default_theme);
    StartupTheme {
        preference,
        resolved_mode,
        theme,
    }
}

fn read_json_file(path: &Path) -> Result<Value, ()> {
    let raw = fs::read_to_string(path).map_err(|_| ())?;
    serde_json::from_str(&raw).map_err(|_| ())
}

fn parse_cached_startup_theme(value: Option<&Value>) -> Option<StartupTheme> {
    let o = value?.as_object()?;
    let preference = parse_theme_preference(o.get("preference"))?;
    let resolved_mode = parse_resolved_mode(o.get("resolvedMode")?.as_str()?)?;
    let theme = parse_theme_definition(o.get("theme")?, None).ok()?;
    Some(StartupTheme {
        preference,
        resolved_mode,
        theme,
    })
}

fn parse_theme_preference(value: Option<&Value>) -> Option<ThemePreference> {
    let o = value?.as_object()?;
    let theme_id = o.get("themeId")?.as_str()?.trim();
    if theme_id.is_empty() {
        return None;
    }
    let mode = o.get("mode")?.as_str()?.trim();
    if !matches!(mode, "light" | "dark" | "auto") {
        return None;
    }
    Some(ThemePreference {
        theme_id: theme_id.into(),
        mode: mode.into(),
    })
}

fn parse_resolved_mode(value: &str) -> Option<String> {
    match value {
        "light" | "dark" => Some(value.into()),
        _ => None,
    }
}

fn read_vault_theme(vault_root: &str, theme_id: &str) -> Result<ThemeDefinition, ()> {
    if !is_safe_theme_id(theme_id) {
        return Err(());
    }
    let file_name = format!("{theme_id}.json");
    let path = Path::new(vault_root)
        .join(ESKERRA_DIR)
        .join(THEMES_DIR)
        .join(&file_name);
    let raw = read_json_file(&path)?;
    parse_theme_definition(&raw, Some(file_name))
}

fn parse_theme_definition(
    value: &Value,
    vault_file_name: Option<String>,
) -> Result<ThemeDefinition, ()> {
    let o = value.as_object().ok_or(())?;
    let name = o
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(())?;
    let light = parse_palette(o.get("light")).ok_or(())?;
    let dark = parse_palette(o.get("dark")).ok_or(())?;
    if let Some(file_name) = vault_file_name {
        let id = file_name.strip_suffix(".json").ok_or(())?.to_string();
        if let Some(json_id) = o
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if json_id != id {
                return Err(());
            }
        }
        Ok(ThemeDefinition {
            id,
            name: name.into(),
            source: "vault".into(),
            light,
            dark,
            file_name: Some(file_name),
        })
    } else {
        let id = o
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or(())?;
        Ok(ThemeDefinition {
            id: id.into(),
            name: name.into(),
            source: "bundled".into(),
            light,
            dark,
            file_name: None,
        })
    }
}

fn parse_palette(value: Option<&Value>) -> Option<ThemePaletteWrapper> {
    let palette = value?.as_object()?.get("palette")?.as_array()?;
    if palette.is_empty() || palette.len() > 30 {
        return None;
    }
    let mut colors = Vec::with_capacity(palette.len());
    for entry in palette {
        let color = entry.as_str()?.trim();
        if !is_hex_color(color) {
            return None;
        }
        colors.push(color.to_string());
    }
    Some(ThemePaletteWrapper { palette: colors })
}

fn is_safe_theme_id(theme_id: &str) -> bool {
    !theme_id.is_empty()
        && !theme_id.contains('/')
        && !theme_id.contains('\\')
        && !theme_id.contains("..")
}

fn is_hex_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

fn resolve_mode(mode: &str) -> String {
    match mode {
        "light" => "light".into(),
        "dark" => "dark".into(),
        // The init script corrects auto from matchMedia before first paint.
        _ => "dark".into(),
    }
}

fn escape_js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

pub fn initialization_script(theme: &StartupTheme) -> String {
    let json = serde_json::to_string(theme).unwrap_or_else(|_| "null".into());
    let light_first = theme
        .theme
        .light
        .palette
        .first()
        .map(String::as_str)
        .unwrap_or("#F5F8FB");
    let dark_first = theme
        .theme
        .dark
        .palette
        .first()
        .map(String::as_str)
        .unwrap_or("#031226");
    format!(
        r#"(() => {{
  const startupTheme = {json};
  if (!startupTheme) return;
  const root = document.documentElement;
  const pref = startupTheme.preference || {{mode: 'auto'}};
  const resolvedMode = pref.mode === 'auto'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : (pref.mode === 'light' ? 'light' : 'dark');
  const theme = startupTheme.theme || {{light: {{palette: [{light_first}]}}, dark: {{palette: [{dark_first}]}}}};
  const palette = resolvedMode === 'light' ? theme.light.palette : theme.dark.palette;
  const p0 = palette[0] || (resolvedMode === 'light' ? {light_first} : {dark_first});
  const p1 = palette[1] || p0;
  startupTheme.resolvedMode = resolvedMode;
  root.dataset.uiChrome = resolvedMode;
  root.dataset.startupThemeLock = 'true';
  root.style.colorScheme = resolvedMode;
  root.style.setProperty('--color-app-chrome-backdrop', p0);
  root.style.setProperty('--color-app-chrome-chroma-2', p1);
  window.__ESKERRA_STARTUP_THEME__ = startupTheme;
}})();"#,
        json = json,
        light_first = escape_js_string(light_first),
        dark_first = escape_js_string(dark_first),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cached_startup_theme() {
        let raw = serde_json::json!({
            "preference": {"themeId": "ash", "mode": "dark"},
            "resolvedMode": "dark",
            "theme": {
                "id": "ash",
                "name": "Ash",
                "source": "bundled",
                "light": {"palette": ["#E7E7E7"]},
                "dark": {"palette": ["#282828"]}
            }
        });
        let parsed = parse_cached_startup_theme(Some(&raw)).expect("valid cached theme");
        assert_eq!(parsed.preference.theme_id, "ash");
        assert_eq!(parsed.theme.dark.palette, vec!["#282828"]);
    }

    #[test]
    fn rejects_unsafe_vault_theme_id() {
        assert!(!is_safe_theme_id("../x"));
        assert!(!is_safe_theme_id("a/b"));
        assert!(is_safe_theme_id("my-theme"));
    }

    #[test]
    fn init_script_contains_bootstrap_global() {
        let script = initialization_script(&default_startup_theme());
        assert!(script.contains("__ESKERRA_STARTUP_THEME__"));
        assert!(script.contains("startupThemeLock"));
    }
}
