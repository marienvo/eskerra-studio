//! Rust port of the date-token grammar in
//! `apps/desktop/src/editor/noteEditor/dateToken/dateToken.ts`.
//!
//! Grammar: `@YYYY-MM-DD` or `@YYYY-MM-DD_HHMM` at a word boundary (start of
//! line, or immediately after whitespace). This module is the single source of
//! truth on the Rust side; both the app and the daemon depend on it so the
//! grammar is ported exactly once. Both sides must cite
//! `specs/plans/desktop-reminders-daemon-phased.md` and
//! `specs/architecture/desktop-date-token.md` when changing it.

/// Parsed value of a date token. Mirrors `DateTokenValue` in `dateToken.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateTokenValue {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    /// `hour`/`minute` are both present or both absent (date-only vs. timed).
    pub time: Option<(u8, u8)>,
}

impl DateTokenValue {
    pub fn date_only(year: u16, month: u8, day: u8) -> Self {
        Self { year, month, day, time: None }
    }

    pub fn with_time(year: u16, month: u8, day: u8, hour: u8, minute: u8) -> Self {
        Self { year, month, day, time: Some((hour, minute)) }
    }

    pub fn hour(&self) -> Option<u8> {
        self.time.map(|(h, _)| h)
    }

    pub fn minute(&self) -> Option<u8> {
        self.time.map(|(_, m)| m)
    }
}

pub fn pad2(value: u32) -> String {
    format!("{value:02}")
}

pub fn pad4(value: u32) -> String {
    format!("{value:04}")
}

fn is_leap_year(year: u16) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: u16, month: u8) -> u8 {
    const DAYS: [u8; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if month == 2 && is_leap_year(year) {
        29
    } else {
        DAYS[(month - 1) as usize]
    }
}

pub fn is_valid_calendar_date(year: u16, month: u8, day: u8) -> bool {
    if !(1..=12).contains(&month) || day < 1 {
        return false;
    }
    day <= days_in_month(year, month)
}

fn is_valid_time(hour: u8, minute: u8) -> bool {
    hour <= 23 && minute <= 59
}

/// Canonical `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` form — what the index stores as
/// `normalizedTokenText` and what the grammar re-parses identically. Mirrors
/// `formatDateToken` in `dateToken.ts`.
pub fn format_date_token(value: DateTokenValue) -> String {
    let date = format!(
        "@{}-{}-{}",
        pad4(value.year as u32),
        pad2(value.month as u32),
        pad2(value.day as u32)
    );
    match value.time {
        None => date,
        Some((hour, minute)) => {
            format!("{date}_{}{}", pad2(hour as u32), pad2(minute as u32))
        }
    }
}

/// Parse a single token string (e.g. `@2026-11-27_2300`) into its value.
/// Returns `None` for malformed strings or invalid calendar dates/times.
/// Mirrors `parseDateToken` in `dateToken.ts` exactly, including the
/// leap-year-aware calendar validation and the `@2026-02-29` rejection case.
pub fn parse_date_token(text: &str) -> Option<DateTokenValue> {
    let rest = text.strip_prefix('@')?;
    let bytes = rest.as_bytes();

    // Exactly `\d{4}-\d{2}-\d{2}(?:_\d{4})?` and nothing more.
    let date_len = 10; // YYYY-MM-DD
    if bytes.len() != date_len && bytes.len() != date_len + 5 {
        return None;
    }
    if !is_ascii_digits(&bytes[0..4])
        || bytes[4] != b'-'
        || !is_ascii_digits(&bytes[5..7])
        || bytes[7] != b'-'
        || !is_ascii_digits(&bytes[8..10])
    {
        return None;
    }

    let year: u16 = parse_ascii_digits(&bytes[0..4]) as u16;
    let month: u8 = parse_ascii_digits(&bytes[5..7]) as u8;
    let day: u8 = parse_ascii_digits(&bytes[8..10]) as u8;
    if !is_valid_calendar_date(year, month, day) {
        return None;
    }

    if bytes.len() == date_len {
        return Some(DateTokenValue::date_only(year, month, day));
    }

    if bytes[10] != b'_' || !is_ascii_digits(&bytes[11..15]) {
        return None;
    }
    let hour: u8 = parse_ascii_digits(&bytes[11..13]) as u8;
    let minute: u8 = parse_ascii_digits(&bytes[13..15]) as u8;
    if !is_valid_time(hour, minute) {
        return None;
    }

    Some(DateTokenValue::with_time(year, month, day, hour, minute))
}

fn is_ascii_digits(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.iter().all(u8::is_ascii_digit)
}

fn parse_ascii_digits(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0u32, |acc, &b| acc * 10 + (b - b'0') as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pad2_and_pad4_zero_fill() {
        assert_eq!(pad2(0), "00");
        assert_eq!(pad2(6), "06");
        assert_eq!(pad2(28), "28");
        assert_eq!(pad4(0), "0000");
        assert_eq!(pad4(952), "0952");
        assert_eq!(pad4(2352), "2352");
    }

    #[test]
    fn calendar_date_validation() {
        assert!(is_valid_calendar_date(2026, 6, 6));
        assert!(is_valid_calendar_date(2026, 12, 31));
        assert!(!is_valid_calendar_date(2026, 0, 1));
        assert!(!is_valid_calendar_date(2026, 13, 1));
        assert!(!is_valid_calendar_date(2026, 6, 0));
        assert!(!is_valid_calendar_date(2026, 6, 32));
    }

    #[test]
    fn leap_year_february_29() {
        assert!(is_valid_calendar_date(2028, 2, 29));
        assert!(!is_valid_calendar_date(2026, 2, 29));
        assert!(!is_valid_calendar_date(1900, 2, 29));
        assert!(is_valid_calendar_date(2000, 2, 29));
    }

    #[test]
    fn round_trips_date_with_time() {
        let value = DateTokenValue::with_time(2026, 12, 28, 23, 52);
        let formatted = format_date_token(value);
        assert_eq!(formatted, "@2026-12-28_2352");
        assert_eq!(parse_date_token(&formatted), Some(value));
    }

    #[test]
    fn round_trips_date_without_time() {
        let value = DateTokenValue::date_only(2026, 12, 28);
        let formatted = format_date_token(value);
        assert_eq!(formatted, "@2026-12-28");
        assert_eq!(parse_date_token(&formatted), Some(value));
    }

    #[test]
    fn round_trips_short_years_with_zero_padding() {
        let value = DateTokenValue::date_only(100, 1, 1);
        let formatted = format_date_token(value);
        assert_eq!(formatted, "@0100-01-01");
        assert_eq!(parse_date_token(&formatted), Some(value));
    }

    #[test]
    fn rejects_invalid_calendar_dates() {
        assert_eq!(parse_date_token("@2026-13-99"), None);
        assert_eq!(parse_date_token("@2026-02-29"), None);
        assert_eq!(parse_date_token("@2026-13-01"), None);
    }

    #[test]
    fn rejects_invalid_time_suffix() {
        assert_eq!(parse_date_token("@2026-06-06_2460"), None);
        assert_eq!(parse_date_token("@2026-06-06_9960"), None);
        assert_eq!(parse_date_token("@2026-06-06_123"), None);
    }

    #[test]
    fn accepts_leap_day_when_valid() {
        assert_eq!(
            parse_date_token("@2028-02-29"),
            Some(DateTokenValue::date_only(2028, 2, 29))
        );
    }

    #[test]
    fn rejects_malformed_strings() {
        assert_eq!(parse_date_token("2026-06-06"), None);
        assert_eq!(parse_date_token("@26-06-06"), None);
        assert_eq!(parse_date_token("@2026-6-06"), None);
        assert_eq!(parse_date_token("@2026-06-06:2352"), None);
        assert_eq!(parse_date_token(""), None);
    }

    #[test]
    fn struck_through_token_does_not_parse() {
        // `@~~2026-11-27_2300~~` — the grammar requires digits immediately
        // after `@`, so a struck-through token never parses as a value. This
        // is the mechanism by which the scanner "ignores" struck-through
        // tokens: they simply never match the grammar in the first place.
        assert_eq!(parse_date_token("@~~2026-11-27_2300~~"), None);
    }
}
