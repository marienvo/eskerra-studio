//! Remote podcast artwork caching for `file://` URLs (MediaSession / `navigator.mediaSession` artwork).

use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Max artwork download size (bytes).
const ARTWORK_MAX_BYTES: u64 = 4 * 1024 * 1024;
const ARTWORK_FETCH_TIMEOUT_SECS: u64 = 5;

fn artwork_cache_digest(url: &str) -> String {
    let d = Sha256::digest(url.as_bytes());
    d.iter()
        .take(8)
        .fold(String::with_capacity(16), |mut acc, b| {
            use std::fmt::Write;
            let _ = write!(acc, "{:02x}", b);
            acc
        })
}

fn extension_from_content_type(ct: &str) -> &'static str {
    let c = ct
        .split(';')
        .next()
        .unwrap_or(ct)
        .trim()
        .to_ascii_lowercase();
    if c.contains("jpeg") || c.contains("/jpg") {
        ".jpg"
    } else if c.contains("png") {
        ".png"
    } else if c.contains("webp") {
        ".webp"
    } else if c.contains("gif") {
        ".gif"
    } else if c.contains("svg") {
        ".svg"
    } else {
        ".img"
    }
}

fn file_uri_for_path(path: &Path) -> Result<String, String> {
    let abs = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let s = abs.to_str().ok_or_else(|| "non-UTF8 path".to_string())?;
    Ok(format!("file://{}", s))
}

/// Download remote artwork to the app cache and return a `file://` URI for MediaSession artwork.
#[tauri::command]
pub async fn media_cache_artwork(app: AppHandle, url: String) -> Result<String, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("only http(s) artwork URLs are supported".to_string());
    }

    let digest = artwork_cache_digest(trimmed);
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("mpris-artwork");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(ARTWORK_FETCH_TIMEOUT_SECS))
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("artwork GET failed: {}", res.status()));
    }
    if let Some(len) = res.content_length() {
        if len > ARTWORK_MAX_BYTES {
            return Err("artwork too large".to_string());
        }
    }

    let ct = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ext = extension_from_content_type(ct);
    let dest = cache_dir.join(format!("{}{}", digest, ext));

    if dest.exists() {
        return file_uri_for_path(&dest);
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > ARTWORK_MAX_BYTES {
        return Err("artwork too large".to_string());
    }

    let tmp = cache_dir.join(format!(".{}.{}.part", digest, std::process::id()));
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    match std::fs::rename(&tmp, &dest) {
        Ok(()) => file_uri_for_path(&dest),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            if dest.exists() {
                file_uri_for_path(&dest)
            } else {
                Err(format!("failed to persist artwork: {e}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{artwork_cache_digest, extension_from_content_type};

    #[test]
    fn digest_is_sixteen_hex_chars() {
        let d = artwork_cache_digest("https://example.com/cover.png");
        assert_eq!(d.len(), 16);
        assert!(d.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn extension_from_mime() {
        assert_eq!(extension_from_content_type("image/jpeg"), ".jpg");
        assert_eq!(
            extension_from_content_type("image/png; charset=utf-8"),
            ".png"
        );
        assert_eq!(
            extension_from_content_type("application/octet-stream"),
            ".img"
        );
    }
}
