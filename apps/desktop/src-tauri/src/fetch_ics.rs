use std::time::Duration;

const DEFAULT_TIMEOUT_MS: u64 = 8000;

/// Fetches ICS calendar text off the renderer thread.
///
/// WebView `fetch` to Outlook/Google calendar endpoints fails CORS; doing the request from Rust
/// (reqwest + rustls-tls) bypasses that and keeps network work off the JS main thread. Redirects are
/// followed (these endpoints commonly 302 to a CDN).
#[tauri::command]
pub async fn fetch_ics(url: String, timeout_ms: Option<u64>) -> Result<String, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("ICS download failed with HTTP {}", status.as_u16()));
    }

    res.text().await.map_err(|e| e.to_string())
}
