# Calendar pipeline — PR #153 review follow-ups

Status: resolved. Tracks the actionable findings from the automated reviews on PR #153
(`ics-agenda-and-yearlog`): Greptile, Codex, and CodeQL / GitHub Advanced Security.

Companion to [`calendar-ics-agenda-pipeline.md`](calendar-ics-agenda-pipeline.md), which is the
authoritative design for the pipeline itself. This file is the punch-list to get that PR mergeable
and to close the correctness gaps the bots flagged.

Most bot comments were against earlier commits and had already been addressed by `d4963c86`
("Fix CodeQL ReDoS alerts, month-end overflow, and wire live-row bridge") by the time this pass ran.
Only **#1** (SSRF), **#4** (EXDATE/CANCELLED), and **#7** (timed key) needed new work.

| # | Item | Outcome |
|---|------|---------|
| 1 | SSRF via IPv4-mapped IPv6 | Fixed: unwrap `to_ipv4_mapped()` in `is_disallowed_ip` + tests. |
| 2 | Live-row skip in trigger | Already done — `getLiveRowUri` wired in `TodayHubCanvas`, predicate used in runner. |
| 3 | Timezone-dependent CI test | Already done — fixture uses floating `DTSTART:20260116T100000`. |
| 4 | EXDATE / STATUS:CANCELLED | Fixed: both parsed and excluded in `parseIcsEvents` + tests. |
| 5 | Monthly RRULE overflow | Already done — `addMonthsFromAnchor`. |
| 6 | Agenda `↺m` overflow | Already done — explicit month construction + `endOfMonth` clamp. |
| 7 | Timed dedup key | Fixed: title added to timed key (overlapping events kept distinct); trade-off documented. |
| 8 | CodeQL ReDoS (63–68) | Already resolved — no open code-scanning alerts. |
| 9 | `determinateRssPercent` name | Already done — renamed `determinateSyncPercent`. |
| 10 | Coalescing-wrapper test | Already done — `runDesktopCalendarPipeline (coalescing)` suite present. |
| 11 | CodeQL ReDoS regression (alert 68) | Fixed: `normalizeAgenda` trailing-trim now uses `trimEnd()` instead of `/\s+$/`. |
| 12 | Cross-month heading order | Fixed: insertion-point search stops at later-month headings so an earlier-month block lands first. |

## Second pass — findings on commit `2f5909ed`

After the first follow-up pass landed, the bots re-reviewed the head commit and surfaced two more items
(both fixed in this pass):

### 11. CodeQL ReDoS still open (alert 68, high) — `normalizeAgenda.ts:991`
The earlier ReDoS sweep shifted line numbers and left one polynomial regex on feed input: the final
trailing-whitespace trim `… .replace(/\s+$/, '') + '\n'`. `/\s+$/` backtracks on long whitespace runs.

- Fix: replace with `.trimEnd()` (linear, semantically identical for the trailing run). No new test —
  the `normalizeAgenda` golden snapshot stays byte-identical and is the regression anchor.

### 12. Cross-month heading order — `cellMerge/mergeCalendarCellContent.ts`
The insertion-point search only stopped at later-sorting `pipelineItem` lines, ignoring `monthHeading`
lines. On a cross-month week first filled with later-month content (e.g. February), a subsequently
merged earlier-month item (January) was spliced at the first later-month *item* — i.e. *after* the
later-month heading — yielding `February → January → …`.

- Fix: also stop at a `monthHeading` whose resolved month sorts after the incoming item. Headings carry
  no year, so a `monthOrdinalInWeek` helper resolves `monthIdx` to a `year*12+month` ordinal via the
  week range (handles Dec→Jan week boundaries).
- Test: cross-month week (Jan 26–Feb 1) — Feb-only cell + a merged Jan item asserts the January block
  precedes February, plus a second-run idempotence check.

The pipeline core is well-structured and well-tested; every item below is an edge-case fix with an
isolated, testable change. The `normalizeAgenda` golden snapshot is the regression anchor — verify
it after each agenda-touching step.

## P1 — blocking (fix before merge)

### 1. SSRF bypass via IPv4-mapped IPv6
`apps/desktop/src-tauri/src/fetch_ics.rs` — `is_disallowed_ip`

`::ffff:127.0.0.1` parses as `IpAddr::V6` and passes every current V6 check (`is_loopback`,
`is_multicast`, `is_unspecified`, ULA/link-local prefix matches), yet most OS TCP stacks dial the
underlying loopback `127.0.0.1`. Same gap for any private IPv4 expressed as a mapped address
(`::ffff:192.168.0.1`). This undermines the explicit private-IP blocklist.

- Fix: in the `V6` arm, `if let Some(ipv4) = v6.to_ipv4_mapped() { return is_disallowed_ip(IpAddr::V4(ipv4)); }`
  before the existing V6 checks.
- Test: unit cases for `::ffff:127.0.0.1` and `::ffff:10.0.0.1` → disallowed.

### 2. Live-row skip not wired into the production trigger
`apps/desktop/src/hooks/useCalendarPipelineTrigger.ts`

The runner only avoids active Today Hub rows when `isRowLiveEdited` is supplied, but the production
trigger passes only `onProgress`. Refreshing calendars while editing (or with a debounced row persist
pending) reads the stale disk body and writes the row; reconcile then skips reloading because live
content differs, and the next autosave can clobber the calendar insertion. This is the highest
data-loss risk in the PR — the "fail-closed / live-row skip" guarantee is currently dormant in the app.

- Fix: pass a live-row predicate (and a flush, if available) from the trigger into
  `runCalendarPipelineDesktop`, so the runner's tested skip is actually active.

### 3. Timezone-dependent test fails in non-CET CI
`apps/desktop/src/lib/calendarPipeline/runCalendarPipelineDesktop.test.ts:136`

`DTSTART:20260116T090000Z` (09:00 UTC) is asserted as `10:00 Team sync` — only true in CET. A UTC CI
runner sees `09:00` and fails.

- Fix: use floating local time `DTSTART:20260116T100000` (drop the `Z`) and remove the UTC/CET note.

## P2 — correctness (with or right after merge)

### 4. EXDATE / STATUS:CANCELLED ignored
`packages/eskerra-core/src/calendarPipeline/parseIcsEvents.ts` — `parseVevents`

Cancelled occurrences of recurring events are written into Calendar cells as valid entries, with no
warning. Note: stale-line cleanup is out of scope by design, but emitting cancelled events is a
parse-correctness bug, not a cleanup gap.

- Fix: parse `EXDATE` and exclude matching occurrences during recurrence expansion; skip VEVENTs with
  `STATUS:CANCELLED`.
- Test: fixture with an EXDATE and a cancelled event.

### 5 & 6. Monthly recurrence overflow (ICS + agenda) — one shared fix
`parseIcsEvents.ts` (monthly RRULE) and `agenda/normalizeAgenda.ts` (`↺m` replan)

`Date.setMonth` overflows before clamping: `2026-01-31` + 1 month → `2026-03-03`, so every later
instance lands on the 3rd and February is silently skipped. Both code paths share the bug.

- Fix: compute target year/month explicitly, then clamp the original day-of-month into that month's
  length, instead of letting `Date` overflow mutate the day. Extract one helper and use it in both
  places.
- Test: monthly rule anchored on the 31st emits month-end (or documented clamp) per occurrence;
  re-check the agenda golden snapshot.

### 7. Timed-event dedup collision
`packages/eskerra-core/src/calendarPipeline/cellMerge/calendarItemKey.ts` (+ `mergeCalendarCellContent.ts`)

The timed key is `YYYY-MM-DD|HH:MM` with no title component. Two distinct events at the same wall-clock
minute (e.g. a 09:00 standup and a 09:00 planning session) collide on `seen.has(key)`; the second is
silently dropped and never reaches the user.

- Fix: include a normalized title in the timed key → `YYYY-MM-DD|HH:MM|<title>`, preserving the
  same-time-same-title dedup while letting same-time different-title events coexist.
- Test: update `roundtripKeyStability.test.ts` (key shape changes); add a same-time/different-title case.

### 8. CodeQL ReDoS — 6 polynomial-regex alerts (63–68)
`agenda/agendaShared.ts`, `agenda/normalizeAgenda.ts`, `cellMerge/calendarItemKey.ts`

Polynomial regexes on library (untrusted feed) input. Same class of alert already fixed elsewhere in
the repo — reuse that approach.

- Fix: anchor patterns and replace unbounded `\s*` / `=+` / repeated groups with bounded quantifiers.
- Verify: CodeQL alerts 63–68 resolved.

## P3 — polish / coverage (non-blocking)

### 9. Misleading variable name
`apps/desktop/src/components/EpisodesPane.tsx` — `determinateRssPercent` now also drives calendar
sync; rename to `determinateSyncPercent`.

### 10. No test for the coalescing wrapper
`apps/desktop/src/lib/calendarPipeline/runCalendarPipelineDesktop.ts` — tests only exercise the inner
`runCalendarPipelineDesktop`, never `runDesktopCalendarPipeline`. The coalescing contract (concurrent
callers share one promise; a mid-run listener gets later progress; `active` resets on completion/error)
is the part most likely to regress silently.

- Add: a test firing `runDesktopCalendarPipeline` twice concurrently, asserting a shared result and
  that `fs.writes` is populated once.

## Suggested commit order

1. Security + data-loss: #1, #2, #3 (unblock a safe merge).
2. Recurrence bundle: #4, #5, #6 in one commit (shared month-clamp helper + EXDATE) with fixtures.
3. Dedup: #7 with the updated round-trip test.
4. CodeQL: #8.
5. Polish: #9, #10.

Keep clusters in separate small commits so the `normalizeAgenda` golden snapshot can be re-verified
per step.
