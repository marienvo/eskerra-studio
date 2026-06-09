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
  - Security boundary: only public `https://` feeds are allowed. Localhost, loopback, private,
    link-local, multicast, unspecified, and hosts resolving to those addresses are rejected. Redirect
    targets are revalidated before following.
  - Resource caps: per-feed timeout is clamped to 500-15000ms, response bodies are capped at 2MB, and
    logs redact feed URL paths/query strings because calendar URLs often contain bearer-like tokens.
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
  (`weekStartForDate`) and returns structured `CalendarItem[]` buckets, not finished markdown. Rendering
  happens only inside the Calendar-cell merge layer.
- Item sort order is deterministic: date, timed-before-untimed, time, then source (agenda before
  calendar). Timed agenda bullets keep a `[🗓️](<mdAgenda>)` link prefix.
- Dedup uses the same `calendarItemKey` contract as the cell merge: a calendar timed event is dropped
  when an agenda bullet shares the same day + time; untimed items dedup by day + normalized title with
  **agenda precedence**.

## Part 3b — Calendar-cell merge contract

The Calendar column merge is deliberately **insert-only**. Existing Calendar cell text is never
re-rendered, reordered, or deleted. Parsing existing lines is read-only and is used only to find
identity keys, month headings, and best-effort insert positions. If the row cannot be split into the
configured column count, the pipeline fails closed and skips the write.

### Never allowed

- Replacing the whole Calendar segment with generated body.
- Touching other row columns. Only the split segment at `calendarColumnIndex` may change.
- Deleting existing Calendar lines. Canceled or stale source events remain visible until the user edits
  them.
- Writing week-entry files before the current week-start.

### Allowed

- Add missing pipeline lines in a best-effort chronological position.
- Add a month heading only when that month is not already represented in the cell.
- Return byte-identical output for the same `now`, sources, and existing cell, so the runner skips
  no-op disk writes.

### Existing line classification

Each non-empty Calendar cell line is classified by `parseCalendarCellLines`:

| Type | Recognition | Merge behavior |
|------|-------------|----------------|
| `MonthHeading` | `**{optional emoji} {Month}**` with fuzzy month matching | Preserve; add another heading only if that month is absent |
| `PipelineItem` | `**{Wd} {day}:** {body}` with a 3-letter weekday and day `1..31` | Dedup by item key; existing line wins |
| `UserFreeform` | Anything else | Always preserve; never dedup away |

User freeform examples include bullets, paragraphs, checklist lines, and calendar-like lines that do
not match the exact pipeline item shape.

### Item keys

`calendarItemKey` is shared by bucketing and cell merge:

- Timed: `{YYYY-MM-DD}|{HH:MM}`.
- Untimed: `{YYYY-MM-DD}|{normalizedTitle}`.

`normalizedTitle` strips the agenda icon link prefix, normalizes wiki-link markup, removes a leading
time, collapses whitespace, and compares case-insensitively. If an incoming item has the same key as
an existing `PipelineItem`, it is not inserted again, even if the existing body text differs. This
lets user edits to generated-looking lines win and prevents append loops.

### Insert order

Existing lines keep their exact bytes and relative order. For each missing incoming item:

1. Sort incoming items by date, timed-before-untimed, time, source (`agenda` before `calendar`), then
   original order.
2. Insert before the first existing or newly inserted `PipelineItem` that sorts later; otherwise append
   at the end of the cell. `UserFreeform` lines are ignored for positioning but are never moved.
3. Insert the item's month heading immediately before the item only when no existing month heading or
   earlier inserted heading represents that month.
4. If the cell is blank, render the full sorted owned cell from scratch.

### Upsert scope

Only in-scope incoming items are proposed for insertion:

| Source | Scope |
|--------|-------|
| ICS timed | `start > now` only |
| ICS untimed | today and future |
| Agenda untimed | strictly future days (`day > today`) |
| Agenda timed | today and future |

Past week rows are frozen at the runner level. Existing out-of-scope lines are preserved.

### Row-level fail-closed behavior

`upsertCalendarColumnInRow` splits rows with `splitTodayRowIntoColumns`, merges only the Calendar
segment with `mergeCalendarCellContent`, and writes back through `mergeTodayRowColumns` +
`normalizeTodayHubRowForDisk`. If a non-blank row has anything other than `columnCount - 1`
canonical `::today-section::` delimiters, or if `calendarColumnIndex` is out of range, it returns
`{kind: "skip"}`. The desktop runner reports that skip as warning telemetry and does not write.

The key append-loop guard is covered by round-trip tests: a rendered pipeline line parsed from the
cell must produce the same `calendarItemKey` as the original structured item, and applying the same
merge twice must be byte-identical.

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

Trigger: the main vault sync action runs the calendar pipeline before Git sync
(`useCalendarPipelineTrigger` → `runDesktopCalendarPipeline`, run-coalesced). The status-bar sync
button and sync-before-close both run calendar sync first; Git sync proceeds afterward even when a
calendar source fails. No startup-path work.

## Performance budget

- **Why:** user-triggered calendar refresh into Today Hub.
- **Startup path?** No — manual trigger; reuses existing vault index refs.
- **TS vs Rust:** network fetch + file I/O in Rust (CORS-safe, off-renderer, native disk);
  parsing/transform in TS (small data — one user's calendars — so default-TS applies). No new TS deps.
- **Mitigations:** yield between hubs; skip no-op writes; touch only affected week files.
- **Resource caps:** max 10 ICS feeds per hub; max `daysAhead` 60; max `timeoutMs` 15000; max ICS
  body 2MB; no startup-path fetches.

## Tests

- Core Vitest (`packages/eskerra-core/src/calendarPipeline`): config/Calendar-index resolution from
  `mock-vault/Work/Today.md`; ICS window/RRULE/all-day/dedup; agenda normalization golden snapshot +
  idempotency against `mock-vault/General/🗓️ Personal agenda.md`; bucketing order/dedup/week-start;
  upsert preserve + idempotency.
- Desktop Vitest (`apps/desktop/src/lib/calendarPipeline`): `runCalendarPipelineDesktop` with a mocked
  `VaultFilesystem` + mocked `fetch_ics`; a no-op second run performs zero writes; past weeks untouched.
