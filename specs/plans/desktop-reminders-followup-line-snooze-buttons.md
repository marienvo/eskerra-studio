# Desktop reminders — follow-up: reminder-line copy, app snooze, GNOME remove

Status: **Planned** (follow-up to the now-completed reminder-daemon feature — its phased
plan was retired once Phases 0–7 shipped, and its architecture is canonically captured in
[ADR 003](../adrs/003-adr-reminder-daemon.md)). This plan does **not** re-open the daemon
architecture, identity, write-back, or merge invariants — those stay locked in ADR 003.
It adds three user-facing refinements on top of the finished feature.

## Why

After dogfooding the shipped daemon three gaps surfaced, all in the **presentation /
action surface**, none in the correctness core:

1. **Notification copy repeats the timestamp and omits the actual reminder text.** Both
   the GNOME notification and the in-app Notifications-pane row show the note title plus
   the raw `@YYYY-MM-DD_HHMM` token, but never the *line the user actually wrote*. The
   token tells you nothing you didn't already see; the line ("Call dentist", "Pay the
   invoice") is the point.
2. **Snooze is only reachable from the GNOME popup.** Once the popup is gone — including
   right after the user **clicks it to open the app** — there is no way to snooze. Snooze
   must also live on the app's reminder row.
3. **The GNOME `remove` button is invisible.** The daemon sends four explicit actions
   (snooze-3 / snooze-1 / snooze-0 / remove); GNOME Shell caps visible action buttons at
   **3**, so `remove` silently falls off the end. The user sees three snoozes and no way
   to strike the reminder from the popup.

## Target copy (both GNOME and the in-app pane)

Today:

```
[Note title]
Now: @2026-11-27_2300 — [Note title]
```

Becomes:

```
[Note title]
Call the dentist back (23:00)
```

i.e. **line 1** = note title (unchanged, the notification `summary` / row header);
**line 2** = the token's **containing line**, *trimmed*, with the **leading list bullet
removed** and the **`@…` token removed**, followed by the reminder time in **`(HH:MM)`**
(24-hour, local). The timestamp is never repeated as a token; its only echo is the
compact `(HH:MM)`. This identical render is produced from one shared index field on both
surfaces. **When the line is only the token** (nothing left after cleaning), the time
moves onto the title — `Daily note (23:00)` on a single line, with no empty second line.

## Decisions (locked — incorporating product answers)

| Topic | Decision |
|---|---|
| GNOME action set (3-button cap) | Send exactly **3 explicit actions: snooze-1 ("Remind 1 min before"), snooze-0 ("Remind at due time"), remove ("Remove")** + the implicit `default` (body click → open). **Drop snooze-3 (T-3)** to make room for `remove`. The `default` action is the body click, not a button, so it does **not** consume one of the three slots. |
| App snooze surface | A compact **"Snooze" dropdown/menu** on each reminder row (the pane is not button-limited) offering **all three** snoozes — T-3, T-1, at-due — next to the existing Remove/Open affordances. The row stays narrow: `[Snooze ▾] [×]`. |
| Snooze semantics (app) | **Identical to the GNOME/daemon rules** — snooze-N targets `dueAt − N·min` and runs through the *same* `scheduler::apply_action` path (no second snooze model). A snooze whose target is already past is an **expired no-op** on the daemon side; the app **disables/hides** those expired options client-side so the menu only ever offers live snoozes. When all three are expired (fully overdue reminder) the Snooze button is hidden and only Remove/Open remain. |
| Reminder line storage | Add **one new index field** carrying the cleaned reminder line, computed **once** by the Rust scanner so GNOME and the app render byte-identical copy (single source of truth for the cleaning). The `(HH:MM)` suffix is derived from `dueAtMs` at render time on each surface (so it stays correct after a settings-only `dateOnlyDefaultTime` re-derive, which updates `dueAtMs` without re-running the scanner's cleaning). |
| Index schema compatibility | **Additive, backward/forward compatible — no `schemaVersion` bump.** The new field is `#[serde(default)]` in Rust and optional in TS; the structs do not use `deny_unknown_fields`, so an old reader ignores it and a new reader tolerates its absence (the daemon refills it on the next scan). ADR §3 is updated to document the field (the schema-lock rule requires the ADR change in the same PR), but the major version stays **1**. (Alternative — bump to 2 and let the daemon rebuild — is rejected as needlessly disruptive for a cosmetic, derived field.) |
| Snooze IPC | Extend `dev.eskerra.Reminders1` with **`SnoozeReminder(IN s noteUri, IN s id, IN u minutes, OUT s result)`**, mirroring `RemoveReminder`'s contract. `noteUri` is routing context only; resolution is **by `id`** against the daemon-owned index. Transport-level failure → app-side **`snooze-unavailable`** (retry, never a local write), exactly parallel to `remove-unavailable`. |

### What this plan explicitly does **not** change

- Identity, `contextAnchor`, `scanFingerprint`, ordinal/duplicate handling, write-back
  safety rules, the per-note write lock, merge/state-migration — all untouched.
- The pre-existing deviation that `fireSource`/`snoozedFireAtMs` are not yet materialized
  in code (snooze persists via `fireAtMs` + the `lastNotifiedMs` guard). App-driven
  snooze rides the **same** `apply_action`/persist path as the GNOME-driven snooze, so it
  inherits the same behavior and does not require closing that deviation. Reconciling the
  schema fields stays a separate, already-tracked cleanup.

---

## Phases

Each phase is independently shippable and test-guarded (Vitest for TS, `cargo test` for
Rust). Phase A is a prerequisite for the copy change in Phase B and the row reformat in
Phase C; Phases B and C are otherwise independent and could ship in either order.

### Phase A — Reminder line text in the shared core + index

**Scope:**
- **Scanner** (`crates/eskerra-reminder-core/src/scanner.rs`): for every token, in
  addition to the existing `context_anchor` (which masks the token and is a *hash*), emit
  a new `display_line: String` on `ScannedToken` — the token's **containing line**
  (already `\r`-trimmed by `line_spans`) run through a single pure helper
  `clean_reminder_line(line, token_byte_from, token_byte_to)` that:
  1. removes the **byte slice of this token** from the line (so the timestamp isn't
     repeated; other tokens on the same line are preserved);
  2. strips a single **leading list marker** — `- `, `* `, `+ `, or an ordered marker
     `N. ` / `N) ` — and any leading blockquote `>`/heading `#` run, matching how the
     line reads as a task;
  3. **trims** leading/trailing whitespace and **collapses** interior runs of whitespace
     (including the gap the removed token left behind) to single spaces.
  The helper is pure and uses the **byte span** to excise the token (never char offsets),
  consistent with the rest of the scanner.
- **Index** (`index.rs`): add `display_line: String` to `Reminder` with
  `#[serde(default)]`; `fresh_reminder_from_scan` copies it from the scanned token. It is
  **scan-derived, not mutable state**, so the duplicate-aware merge needs no carry rule —
  each rescan recomputes it from fresh tokens. Confirm `merge.rs` rebuilds reminders from
  the fresh scan (so a changed surrounding line updates `display_line`) and only carries
  the *mutable* state fields (`state`, snooze, `lastNotifiedMs`, `stale`) as today.
- **TS mirror** (`apps/desktop/src/lib/reminderIndex.ts`): add `displayLine?: string` to
  `Reminder`; tolerate its absence (older index) by treating it as empty.
- **ADR §3**: add the `displayLine` row to the `Reminder` table; note it is derived,
  cosmetic, never identity, additive at `schemaVersion: 1`.

**Deliverables:** the index carries a clean, render-ready reminder line; no behavior
change yet (Phases B/C consume it).

**Tests (mandatory):**
- `clean_reminder_line` vectors: leading `- ` / `* ` / `+ ` / `1. ` / `> ` markers;
  token mid-line vs. line-start vs. line-end; **two tokens on one line** (only the
  reminder's own token removed); interior double-spaces collapsed; **empty after cleaning**
  (line was only the token + bullet) → returns empty string; **non-ASCII before the token**
  (emoji / accented text) excised by byte span with no panic and exact surrounding bytes.
- `ScannedToken.display_line` is populated and matches the helper output for the
  non-ASCII fixture already used by `non_ascii_before_token_yields_exact_byte_span`.
- Index round-trips `displayLine` through JSON; a JSON document **without** `displayLine`
  still parses (serde default → empty), proving backward compatibility (no version bump).
- `reminderIndex.test.ts`: parses an index with and without `displayLine`.

**LLM advice:** **Sonnet 4.6, thinking medium** — mechanical, pure, fully test-guarded,
with the byte-span discipline already established in `scanner.rs`. The only subtlety
(token excision by byte span, not char offset) is well-precedented in this file.

### Phase B — GNOME notification body reformat + 3-button action set

**Scope** (`crates/eskerra-reminderd/src/notify.rs`):
- `NotificationRequest::for_reminder`: build the body as
  `format!("{} ({})", display_line, hhmm_local(reminder.due_at_ms))`, where
  `hhmm_local` renders `dueAtMs` to local `HH:MM` (24-hour) via chrono `Local`. **Drop**
  the `FireKind`-based `"Reminder …"` / `"Now: …"` prefix and the token repeat — both
  Lead and AtTime fires use the same line+time body. `summary` (note title) is unchanged.
  - **Empty `display_line` fallback (locked):** when the cleaned line is empty (the line
    was only the token, possibly with a bullet), do **not** emit a bare `"(23:00)"` body.
    Instead move the time onto the title: `summary = "{title} (HH:MM)"` and `body = ""`.
    So a token-only line renders as a single `Daily note (23:00)` headline with no empty
    second line.
- `NotificationRequest::actions()`: return exactly
  `[(snooze-1, "Remind 1 min before"), (snooze-0, "Remind at due time"), (remove, "Remove")]`.
  Remove the snooze-3 entry. The `ZbusNotifier::send` `default`/"Open note" action is
  unchanged (body click, not a button). `parse_action_key` keeps accepting `snooze-3`
  for forward/backward compatibility (a lingering old popup's T-3 button must still
  route), so only the *outgoing* set shrinks.

**Deliverables:** GNOME notifications show note title + the reminder line + `(HH:MM)`, and
a working **Remove** button alongside two snoozes.

**Tests:**
- Body equals `"{displayLine} (HH:MM)"`; does **not** contain `"Now:"`, `"Reminder "`, or
  the `@…` token for a non-empty line; HH:MM matches the local render of `dueAtMs`.
- Empty-line fallback: a token-only line yields `summary == "{title} (HH:MM)"` and an
  empty `body` (no bare `"(HH:MM)"` second line).
- `actions()` has exactly 3 entries and includes `remove`; snooze-3 is absent from the
  outgoing set but `parse_action_key("snooze-3")` still resolves (compat).
- Existing `request_for_reminder_carries_id_and_title` updated for the new body shape.

**LLM advice:** **Sonnet 4.6, thinking medium** — small, localized copy/array change.
Verify nothing else asserts the old body string (grep tests). No D-Bus API surface change.

### Phase C — Snooze IPC + app snooze dropdown + pane row reformat

**Scope — daemon IPC:**
- `service.rs`: add `SnoozeReminder(IN s noteUri, IN s id, IN u minutes, OUT s result)` to
  the `dev.eskerra.Reminders1` interface. Unlike `RemoveReminder` (which runs the
  write-back off the loop under a per-note lock), snooze only mutates the in-memory index
  and re-arms the scheduler, so route it **onto the run loop** and reply with the outcome:
  add `DaemonEvent::Snooze { id, minutes, reply: Sender<String> }`; the loop calls
  `daemon.on_action(&id, 0, Action::Snooze { minutes }, now_ms())` (notification_id `0` =
  no triggering popup to replace) and sends the mapped result string back. `on_action`
  already persists, re-arms, and — for snooze-0 at exactly due — sends the at-time
  notification, so no new scheduling logic is required.
- Map `ActionOutcome` → IPC string: `Rescheduled` → `"rescheduled"`, `FiredNow` →
  `"fired"`, `ExpiredNoOp` → `"expired"`, `Unknown` → `"unknown"`. Pin these in the ADR §7
  table next to the `RemoveReminder` results.
- **ADR §7**: document the new method and its result space; **ADR §8-parallel**: add the
  transport-failure row `snooze-unavailable` (app-only, never a local write).

**Scope — app IPC + hook:**
- `apps/desktop/src-tauri/src/reminders.rs`: add `reminders_snooze(note_uri, id, minutes)`
  mirroring `reminders_remove` — Linux calls `SnoozeReminder` over the session bus with
  the same 5s timeout; transport/registry error → `"snooze-unavailable"`; non-Linux →
  `"snooze-unavailable"`. Register the command.
- `apps/desktop/src/hooks/useReminderPane.ts`: add
  `snoozeReminder(noteUri, id, minutes): Promise<void>` that invokes the command and
  **re-reads the index** afterward (snooze changes `fireAtMs`/`state`, surfaced on the
  next read — the existing 15s poll + `vault-files-changed` already cover this, but an
  immediate re-read keeps the row responsive). On `"snooze-unavailable"` reuse the same
  observability + non-blocking pattern as `remove-unavailable` (a brief inline hint;
  optional best-effort daemon restart off the UI thread). Snooze does **not** need a
  persistent per-row failure state like remove — a failed snooze can simply surface a
  transient hint and let the user retry from the menu.

**Scope — app UI:**
- `apps/desktop/src/lib/reminderPane.ts`: carry `displayLine` onto `ReminderPaneRow`
  (from `Reminder.displayLine`); add a pure `reminderTimeLabel(dueAtMs)` → local `HH:MM`.
  Add a pure helper `liveSnoozeOptions(dueAtMs, nowMs)` returning which of {3, 1, 0} have
  `dueAt − N·min > now` (0 ⇒ `dueAt > now`) so the menu only offers non-expired snoozes.
- `apps/desktop/src/components/NotificationsPanel.tsx`:
  - **Row reformat (consumes Phase A):** header line stays the note name; replace the
    muted `normalizedTokenText` with the **`displayLine (HH:MM)`** line. **Empty-line
    fallback (locked, mirrors GNOME):** when `displayLine` is empty, append `(HH:MM)` to
    the **note-name header** (`Daily note (23:00)`) and render **no** second line, rather
    than a bare `(HH:MM)`. Keep the existing relative status line (`reminderDueLabel`,
    "in 5 min" / "overdue") and the stale/unavailable status messages as-is.
  - **Snooze menu:** add a compact `[Snooze ▾]` control on its own bottom row (right-aligned),
    opening a small menu with the live options ("3 min before", "1 min before", "At due time").
    Hidden entirely when `snoozeMenuOptions` is empty (still before the T-3 window, fully
    overdue, or every offset expired) or the reminder is `stale`/`removing`. Each item calls
    `onSnoozeReminder(noteUri, id, minutes)`.
  - Thread `onSnoozeReminder` through `NotificationsPanelProps` and wire it from the
    `useReminderPane` consumer alongside `onRemoveReminder`.

**Deliverables:** snooze works from the app pane (so it is reachable after clicking the
GNOME popup to open the app), the row shows the reminder line + time instead of the raw
token, and snooze degrades gracefully when the daemon is unreachable — never a local
write.

**Tests:**
- **Rust:** `apply_action` snooze paths already covered; add a service-routing test that a
  `Snooze` event maps each `ActionOutcome` to the right IPC string and that `on_action`
  with `notification_id = 0` for snooze-0-at-due still fires once (guarded, no
  double-fire). Confirm an unknown id → `"unknown"` and a stale reminder → `"expired"`.
- **TS:** `liveSnoozeOptions` boundary table (before T-3, between T-3 and T-1, between T-1
  and due, exactly at due, past due → none); `reminderTimeLabel` formats local HH:MM;
  `reminderToPaneRow` carries `displayLine`.
- **Hook (`useReminderPane.test.ts`):** `snoozeReminder` invokes the command, re-reads the
  index on success, and on `"snooze-unavailable"` does **not** mutate the note and keeps
  the row interactive; reuses the `remove-unavailable` observability assertion shape.
- **Component:** the menu hides when all snoozes are expired / row is stale; selecting an
  option calls `onSnoozeReminder` with the right minutes; the row renders
  `displayLine (HH:MM)` and no longer renders the raw `@…` token; a reminder with an empty
  `displayLine` renders `note name (HH:MM)` in the header and no second line.

**Risks:** the snooze menu is a new interactive surface in the pane — keep it
keyboard-accessible and dismissible, and make sure the minute-tick re-evaluates
`liveSnoozeOptions` so options expire/hide at the right wall-clock minute (this repo has a
dedicated `review-state-consistency-closure-safety` skill for exactly the timer + row
state interaction). The snooze IPC runs **on** the run loop (cheap, index-only); do not
copy the off-loop worker pattern from remove, which exists only because write-back holds a
per-note file lock.

**LLM advice:** **Opus 4.8, thinking medium** for the daemon IPC wiring + the
`on_action`/loop routing (gets the FiredNow-on-snooze-0 and double-fire guard subtly
wrong if rushed); **Sonnet 4.6, thinking medium** for the Tauri command, hook, and the
pane menu (mirrors the existing `reminders_remove` / `removeReminder` / Remove-button
patterns). Run `review-state-consistency-closure-safety` over the menu + minute-tick diff.

---

## Cross-cutting notes

- **One render path for the line.** The cleaning lives only in Rust (`clean_reminder_line`);
  both surfaces consume the stored `displayLine` and append `(HH:MM)` derived from
  `dueAtMs`. Do not reimplement the cleaning in TS — that would reintroduce the
  two-implementations-must-match hazard the daemon design (ADR 003) deliberately avoids.
- **Compatibility.** No `schemaVersion` bump, no IPC removal: an old app reading a new
  index ignores `displayLine`; a new app reading an old index falls back to an empty line
  until the daemon rescans; an old popup's `snooze-3` button still routes. Ship daemon and
  app together (the RPM already bundles both) and none of these windows are user-visible
  beyond a brief, self-healing cosmetic gap.
- **Observability.** Add `snooze-unavailable` rate alongside the existing
  `remove-unavailable` signal in the app, and (optional) a daemon-side `SnoozeReminder`
  result counter mirroring `REMOVE_RESULT`; extend
  [`specs/observability/desktop-reminderd.md`](../observability/desktop-reminderd.md).
