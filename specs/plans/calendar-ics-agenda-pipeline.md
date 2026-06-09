# Calendar / ICS / agenda pipeline → Today Hub week entries

Status: implemented (core + desktop). Authoritative for the calendar pipeline that fills the
**Calendar column** of Today Hub week-entry files from each hub's agenda and ICS feeds.

The pipeline replaces the legacy year-log (`YYYY <title>.md`) PPF-table output. There is no PPF table,
no `⌚ Upcoming.md` intermediate file, and no `==highlight==` (the canvas handles current-week
highlighting). It runs **on demand only** (manual trigger); nothing runs on the startup path.

## Configuration: `Today.md` frontmatter is the source of truth

Each Today Hub (`Today.md`) configures its own calendar feed:

| Key         | Meaning                                                                 |
|-------------|------------------------------------------------------------------------|
| `icsUrl`    | One ICS URL or a YAML list of URLs. Fetched per hub.                    |
| `mdAgenda`  | Vault-relative path of the hub's agenda markdown (Part 2 source).       |
| `start`     | Hub week start day (`monday`, `sunday`, …). Drives week bucketing.      |
| `columns`   | Extra column labels; the implicit column 0 is the week-start date.      |
| `daysAhead` | ICS look-ahead window in days (default 7).                             |
| `timeoutMs` | Per-feed fetch timeout (default 8000, min 500).                        |

**Calendar column resolution.** The pipeline writes into the column named `Calendar`
(case-insensitive). Its split-segment index is `columns.indexOf("Calendar") + 1` (the `+1` accounts
for the implicit week-start column). For `columns: [Next actions, Calendar]` the Calendar column is
grid column 3 / split-segment index 2. **A hub with no `Calendar` column is skipped.**

Parsed by `parseHubCalendarConfig` (`packages/eskerra-core/src/calendarPipeline`).

## Part 1 — ICS fetch + parse

- ICS is fetched by the Rust Tauri command **`fetch_ics(url, timeoutMs)`**
  (`apps/desktop/src-tauri/src/fetch_ics.rs`, reqwest + rustls-tls). Doing the request off the
  renderer bypasses webview CORS for Outlook/Google endpoints and follows redirects. The JS wrapper is
  `fetchIcsDesktop`.
- `parseIcsEvents` (pure, in core) turns ICS text into `{start, summary}[]`:
  - `VEVENT` only; window `[startOfDay(now) .. endOfDay(now + daysAhead)]`.
  - **All-day events are skipped** (`VALUE=DATE` or 8-digit `DTSTART`).
  - `RRULE` expansion for `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` with `INTERVAL`, `COUNT`, `UNTIL`, and
    (weekly) `BYDAY`.
  - Dedup on `uid|timestamp|summary`; sort by time then summary.
- **Timezone limitation:** without a tz database, `...Z` values are UTC and everything else (including
  `TZID=...`) is interpreted in the host's local timezone. Correct for a single user whose calendar
  matches their machine timezone; cross-timezone events may be off. Revisit only if it bites in
  practice (a tz dependency would otherwise be unjustified for one user's calendars).

## Part 2 — agenda normalization (`mdAgenda`)

Detection is per hub's `mdAgenda` file (not a global `🗓️` scan). The file is normalized **in place**
and then read as a bullet source. `normalizeAgenda` (ported from the legacy calendar handler, behavior
preserved) is pure and idempotent for a fixed `now`:

- Canonical H3 titles: `### <Weekday>, <Month> <Ordinal>, <Year>` (dated) or `…, <Rule>` (recurring).
- Month ordering from `now`; recurrence resolution for `↺`, `↺Nd`, `↺Nw`, `↺m`, `↺q`,
  `↺season(a-b)`, nth/last weekday-of-month (`↺2su5`, `↺lastsu3`), etc.
- Today-highlight wraps the H3 title in `==…==`.
- `!1` lift: a top-level bullet (and its indented block) tagged `!1` is moved to the next dated
  occurrence, with `!1` stripped.
- Checked recurring bullets are replanned; ages (`⌚️ <birthYear>, <age> years`) are recomputed.
- Frontmatter and non-month H2 sections are preserved verbatim.

`parseAgendaBullets` extracts `{date, monthHeading, body, timed, time, timeMinutes}` from the
normalized agenda's `###` day blocks (leading `HH:MM` ⇒ `timed`).

## Part 3 — bucket + upsert into Today Hub week entries

Each week-row file (`{hubDir}/YYYY-MM-DD.md`, the 53-week canvas grid) is one "row".

- `bucketCalendarWeekEntries` maps every agenda bullet + ICS event to its hub week-start
  (`weekStartForDate`) and renders the Calendar body as **real markdown lines** (no `<br>`):
  - a `**{month-emoji} {Month}**` heading the first time a month appears in a cell, then one
    `**{Wd} {day}:** {body}` line per item.
  - Sort: by date, timed-before-untimed, time, then source (agenda before calendar).
  - Dedup: a calendar timed event is dropped when an agenda bullet shares the same day + time;
    otherwise items dedup on normalized title with **agenda precedence**.
  - Timed agenda bullets keep a `[🗓️](<mdAgenda>)` link prefix.
- `upsertCalendarColumn` merges the bucketed body into only the Calendar split-segment of the existing
  row: **additive** (preserve other columns and existing/user lines; append missing managed lines
  only; never wipe), then `normalizeTodayHubRowForDisk`. **Idempotent** for a fixed desired body.

## Orchestration (desktop)

`runCalendarPipelineDesktop` (`apps/desktop/src/lib/calendarPipeline`) — on demand only:

1. Discover hubs from the already-built vault markdown index refs
   (`sortedTodayHubNoteUrisFromRefs`; no new scan).
2. Per hub: parse config; skip if no `Calendar` column. Normalize `mdAgenda` and write back **only on
   change**. Fetch each `icsUrl` via `fetch_ics`; parse events. Bucket agenda + ICS.
3. For week-row files within the 53-week horizon: **past weeks (before the current week-start) are
   left untouched**; current + future weeks are upserted. **No-op writes are skipped** (compare new vs
   existing) to avoid needless `vault-files-changed` churn.
4. Yield between hubs to keep the UI responsive. Timing logs around fetch + transform.

**Disk-as-truth:** writes go through `VaultFilesystem.writeFile` and are treated as external edits —
the existing vault-watch reconcile + live-row disk sync update any open hub row. The runner does **not**
hand-mutate `inboxContentByUri` / `todayHubRowLastPersistedRef` (respects the note-body-cache
invariants).

Trigger: a manual "Refresh calendars" action sits next to the podcast RSS-sync action in the Episodes
pane header (`useCalendarPipelineTrigger` → `runDesktopCalendarPipeline`, run-coalesced). No
startup-path work.

## Performance budget

- **Why:** user-triggered calendar refresh into Today Hub.
- **Startup path?** No — manual trigger; reuses existing vault index refs.
- **TS vs Rust:** network fetch + file I/O in Rust (CORS-safe, off-renderer, native disk);
  parsing/transform in TS (small data — one user's calendars — so default-TS applies). No new TS deps.
- **Mitigations:** yield between hubs; skip no-op writes; touch only affected week files.

## Tests

- Core Vitest (`packages/eskerra-core/src/calendarPipeline`): config/Calendar-index resolution from
  `mock-vault/Work/Today.md`; ICS window/RRULE/all-day/dedup; agenda normalization golden snapshot +
  idempotency against `mock-vault/General/🗓️ Personal agenda.md`; bucketing order/dedup/week-start;
  upsert preserve + idempotency.
- Desktop Vitest (`apps/desktop/src/lib/calendarPipeline`): `runCalendarPipelineDesktop` with a mocked
  `VaultFilesystem` + mocked `fetch_ics`; a no-op second run performs zero writes; past weeks untouched.
