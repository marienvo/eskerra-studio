use reqwest::header::LOCATION;
use reqwest::redirect;
use reqwest::Url;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

const DEFAULT_TIMEOUT_MS: u64 = 8000;
const MIN_TIMEOUT_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 15000;
const MAX_REDIRECTS: usize = 5;
const MAX_ICS_BYTES: usize = 2_000_000;

fn clamp_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            // Unwrap IPv4-mapped addresses (::ffff:a.b.c.d) so private/loopback IPv4 ranges
            // can't bypass the blocklist by being expressed in IPv6 form.
            if let Some(ipv4) = v6.to_ipv4_mapped() {
                return is_disallowed_ip(IpAddr::V4(ipv4));
            }
            v6.is_loopback()
                || v6.is_multicast()
                || v6.is_unspecified()
                || matches!(v6.segments()[0], 0xfc00..=0xfdff | 0xfe80..=0xfebf)
        }
    }
}

fn validate_calendar_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("ICS URL must use https".into());
    }
    let Some(host) = url.host_str() else {
        return Err("ICS URL must include a host".into());
    };
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("ICS URL host is not allowed".into());
    }
    let host_for_ip_parse = host
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(ip) = host_for_ip_parse.parse::<IpAddr>() {
        if is_disallowed_ip(ip) {
            return Err("ICS URL IP address is not allowed".into());
        }
    }
    Ok(())
}

fn resolve_public_addrs(url: &Url) -> Result<Vec<std::net::SocketAddr>, String> {
    validate_calendar_url(url)?;
    let host = url
        .host_str()
        .ok_or_else(|| "ICS URL must include a host".to_string())?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("could not resolve ICS host: {e}"))?
        .collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err("ICS host did not resolve".into());
    }
    if addrs.iter().any(|addr| is_disallowed_ip(addr.ip())) {
        return Err("ICS host resolves to a private or local address".into());
    }
    Ok(addrs)
}

async fn read_capped_text(mut res: reqwest::Response) -> Result<String, String> {
    if let Some(len) = res.content_length() {
        if len > MAX_ICS_BYTES as u64 {
            return Err("ICS response is too large".into());
        }
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_ICS_BYTES {
            return Err("ICS response is too large".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|e| format!("ICS response is not UTF-8: {e}"))
}

async fn fetch_once(url: &Url, timeout: Duration) -> Result<reqwest::Response, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "ICS URL must include a host".to_string())?;
    let addrs = resolve_public_addrs(url)?;
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .timeout(timeout)
        .redirect(redirect::Policy::none())
        .resolve_to_addrs(host, &addrs)
        .build()
        .map_err(|e| e.to_string())?;

    client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| e.to_string())
}

/// Fetches ICS calendar text off the renderer thread.
///
/// WebView `fetch` to Outlook/Google calendar endpoints fails CORS; doing the request from Rust
/// (reqwest + rustls-tls) bypasses that and keeps network work off the JS main thread. Redirects are
/// followed (these endpoints commonly 302 to a CDN).
#[tauri::command]
pub async fn fetch_ics(url: String, timeout_ms: Option<u64>) -> Result<String, String> {
    let timeout = Duration::from_millis(clamp_timeout_ms(timeout_ms));
    let mut current = Url::parse(url.trim()).map_err(|e| format!("invalid ICS URL: {e}"))?;

    for _ in 0..=MAX_REDIRECTS {
        let res = fetch_once(&current, timeout).await?;
        let status = res.status();
        if status.is_success() {
            return read_capped_text(res).await;
        }
        if status.is_redirection() {
            let location = res
                .headers()
                .get(LOCATION)
                .ok_or_else(|| "ICS redirect missing Location header".to_string())?
                .to_str()
                .map_err(|e| format!("invalid redirect Location header: {e}"))?;
            current = current
                .join(location)
                .map_err(|e| format!("invalid redirect Location URL: {e}"))?;
            validate_calendar_url(&current)?;
            continue;
        }
        return Err(format!("ICS download failed with HTTP {}", status.as_u16()));
    }

    Err("ICS download redirected too many times".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn clamps_timeout_to_safe_range() {
        assert_eq!(clamp_timeout_ms(None), DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(1)), MIN_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(30_000)), MAX_TIMEOUT_MS);
    }

    #[test]
    fn rejects_non_https_and_local_hosts() {
        assert!(validate_calendar_url(&url("http://example.com/calendar.ics")).is_err());
        assert!(validate_calendar_url(&url("file:///tmp/calendar.ics")).is_err());
        assert!(validate_calendar_url(&url("https://localhost/calendar.ics")).is_err());
        assert!(validate_calendar_url(&url("https://127.0.0.1/calendar.ics")).is_err());
        assert!(validate_calendar_url(&url("https://[::1]/calendar.ics")).is_err());
        assert!(validate_calendar_url(&url("https://192.168.1.20/calendar.ics")).is_err());
        assert!(validate_calendar_url(&url("https://169.254.169.254/latest/meta-data")).is_err());
    }

    #[test]
    fn rejects_ipv4_mapped_ipv6_private_hosts() {
        assert!(is_disallowed_ip("::ffff:127.0.0.1".parse().unwrap()));
        assert!(is_disallowed_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_disallowed_ip("::ffff:192.168.0.1".parse().unwrap()));
        assert!(validate_calendar_url(&url("https://[::ffff:127.0.0.1]/calendar.ics")).is_err());
    }

    #[test]
    fn accepts_public_https_urls() {
        assert!(validate_calendar_url(&url("https://calendar.google.com/calendar.ics")).is_ok());
        assert!(validate_calendar_url(&url(
            "https://outlook.office365.com/owa/calendar/x/calendar.ics"
        ))
        .is_ok());
    }
}
