# Desktop reminders — phased plan (daemon-owned, Rust-level vault monitoring)

Status: **proposed plan** (not yet implemented). Supersedes the "Future reminders
(deferred)" section of [`specs/architecture/desktop-date-token.md`](../architecture/desktop-date-token.md)
once shipped.

## Goal

Turn the existing `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` date tokens into **reminders**:

1. A Rust process monitors all vault markdown files for these timestamps and reacts
   to **on-disk** changes instantly — not only when the change is written through the
   app itself (Syncthing, another editor, the daemon's own writes all count).
2. Reminders appear in the existing Notifications pane, interleaved with the session
   notifications we already have.
3. **Dot ("bolletje") rule:** a reminder counts toward the unread dot only once it is
   in the past or at/after its reminder time. Purely future reminders do not count.
4. Deleting a reminder from the Notifications pane rewrites the token in the note to
   `@~~2026-11-27_2300~~` (struck through, and therefore no longer recognized as a
   token by the grammar).
5. Clicking a reminder row opens the note, scrolls to it, and places the caret
   **immediately after the timestamp**.
6. **5 minutes before** the reminder time the OS (GNOME) shows a notification with
   actions: snooze **3 min / 1 min / 0 min** (i.e. "remind me again at T-3 / T-1 /
   at-time") and **remove**. Remove also performs the strikethrough rewrite.
7. A normal click on the OS notification opens the note (launching the app if it is
   not running).
8. Everything keeps working when the app is "closed": a separate always-on daemon
   owns scanning, scheduling, OS notifications, and the strikethrough writes. The app
   only **reads** the reminder index and renders it.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Process model | **Separate headless daemon** (systemd user service) is the single owner of scanning, OS notifications, and all reminder-driven disk writes. The Tauri app **reads** the index and renders; it never writes strikethrough itself. |
| Date-only tokens (`@2026-11-27`) | Get a **fixed reminder time, default 09:00 local** (configurable). They fire the 5-min-before OS notification and count for the dot exactly like timed reminders. |
| Scan scope | **Whole vault**, every `.md`, excluding hard-excluded / ignored directories (reuse `is_vault_tree_hard_excluded_directory_name` / `is_vault_tree_ignored_entry_name` from `vault_search`). |
| OS notification tech | **Native `org.freedesktop.Notifications` via D-Bus** (`zbus`), with action buttons + callbacks. `tauri-plugin-notification` is insufficient for persistent action buttons on Linux. |
| Token grammar | Unchanged. Single source of truth stays `dateToken.ts`; the Rust side ports the same grammar and both cite this plan + the date-token spec. |

## Architecture overview

```
                    ┌──────────────────────────────────────────┐
                    │  eskerra-reminderd   (systemd --user)      │
                    │                                            │
   vault/*.md ─────▶│  watcher (notify crate, reused logic)      │
   (Syncthing,      │      │                                     │
    app, daemon)    │      ▼                                     │
                    │  scan → reminder model (Rust port of       │
                    │         dateToken grammar)                 │
                    │      │                                     │
                    │      ├──▶ index cache  ◀── app reads/watches│
                    │      │    (XDG data, NOT in vault)          │
                    │      │                                     │
                    │      ├──▶ scheduler (min-heap of fire times)│
                    │      │        │                            │
                    │      │        ▼                            │
                    │      │   D-Bus Notifications (+actions)     │
                    │      │        │ snooze / remove / click    │
                    │      │        ▼                            │
                    │      └──▶ strikethrough writer (sole writer)│
                    │                                            │
                    │  D-Bus service dev.eskerra.Reminders1:      │
                    │    - RemoveReminder(uri, range)  ◀── app    │
                    │    - signal/launch app on click            │
                    └──────────────────────────────────────────┘
                                   │ launch/focus + open(uri,pos)
                                   ▼
                    ┌──────────────────────────────────────────┐
                    │  eskerra app (Tauri)                       │
                    │   - reads index cache, watches it          │
                    │   - renders reminders in Notifications pane │
                    │   - dot logic (due vs future, minute tick) │
                    │   - delete-from-pane → RemoveReminder()     │
                    │   - single-instance: open(uri,pos) → editor │
                    │   - external write reconcile (existing)     │
                    └──────────────────────────────────────────┘
```

### Why a separate process (per AGENTS.md new-process checklist)

1. **Why needed:** the explicit requirement is that reminders fire and rewrite notes
   while the app window is closed. A Tauri window-close tears down the webview; only a
   process that outlives the GUI can guarantee this.
2. **On startup path?** No. It is a separate binary launched by systemd at login; it
   never runs inside the app's first-render path. The app's sacred first-render path is
   untouched.
3. **Can it be deferred?** The *daemon* cannot (it is the feature). Its *scan* is
   deferred/incremental and debounced; it never blocks anything user-facing.
4. **Why Rust:** heavy recurring filesystem scanning + a long-lived watcher +
   D-Bus integration; this is exactly the Rust-justified profile. (TS/Kotlin guidance
   is mobile-only; desktop native work is Rust by the existing app's design.)
5. **Performance risk:** repeated full-vault scans and unbounded watcher batches.
   Mitigation: reuse the debounce + coarse-fallback discipline already proven in
   `vault_watch.rs`; incremental rescans keyed by changed paths; hard batch ceiling.
6. **How measured:** scan duration + reminder count logged; watcher latency target
   < 1s detection→index-update (same budget as the app watcher); D-Bus failures and
   coarse invalidations counted for observability.

### Single-writer invariant (critical)

The daemon is the **only** writer of strikethrough rewrites. The app must never write
the `~~…~~` mutation locally — deleting from the pane calls the daemon's
`RemoveReminder`. This keeps one writer for that mutation and avoids two processes
racing on the same bytes.

When the daemon rewrites a note that is **open in the editor**, it is — by design —
indistinguishable from any other external on-disk edit. It therefore must flow through
the existing `vault-files-changed` → reconcile path (see AGENTS.md *Vault disk sync
invariants* and *Note body cache*). The strikethrough writer must do a
read-modify-write that preserves the rest of the file byte-for-byte and only edits the
token span, so the reconcile/merge logic sees a minimal diff.

### Index cache location

- Lives in the **app's XDG data dir** (e.g. `~/.local/share/eskerra/reminders/<vault-hash>.json`),
  **never** inside the vault `.eskerra/` directory. Rationale: it is device-local
  derived state; putting it under the synced vault would create Syncthing conflicts and
  violate the "source of truth is the note text" model.
- Schema (per reminder): stable `id` (see **Reminder identity** below — **never**
  derived from byte offsets), `noteUri`, `dueAtMs` (the reminder time itself),
  `fireAtMs` (T-5min or snoozed override), `state` (`scheduled` | `due` | `notified`
  | `removed` | `stale`), `lastNotifiedMs`. `tokenFrom`/`tokenTo` are stored **only**
  as a last-scan hint for fast UI caret placement and are treated as advisory — they
  are re-derived by re-scanning before any write (Phase 4) and are never the basis of
  identity or of locating the span to strike.

### Reminder identity (offset-independent)

Offsets drift whenever text above a token changes, so they must not participate in
identity. A reminder's stable `id` is:

```
id = hash(vaultRelativePath + "\0" + normalizedTokenText + "\0" + occurrenceOrdinal)
```

- `vaultRelativePath` — the note's path relative to the vault root (not an absolute
  path, so it survives vault relocation/sync across devices in the same vault).
- `normalizedTokenText` — the canonical token string `@YYYY-MM-DD` /
  `@YYYY-MM-DD_HHMM` (already normalized by the parser; not the raw matched bytes).
- `occurrenceOrdinal` — the **0-based index of this token among identical tokens in
  the same file**, assigned in document order at scan time. This is what
  disambiguates duplicate identical tokens in one note (e.g. two `@2026-11-27_2300`
  lines): the first is ordinal 0, the second ordinal 1, and so on.

Consequences and rules:
- Editing text **elsewhere** in the file does not change any `id` (path, token text,
  and ordinal are all unaffected) — the reminder's `state`/snooze survive rescans.
- Editing the **token text itself** (date/time) yields a new `id`; the old reminder
  vanishes from the scan and the new one appears `scheduled`. This is correct: a
  changed time is a different reminder.
- Adding/removing a **duplicate identical token above another** shifts the
  ordinals of the later duplicates, so their `id`s change. This is an accepted,
  bounded ambiguity that only affects multiple *byte-identical* tokens in one file;
  it never causes a wrong-span write because Phase 4 re-scans and requires a unique,
  high-confidence match before writing (see below). When duplicates make a target
  ambiguous, the write is refused and the reminder is marked `stale`.
- Renaming/moving a note changes `vaultRelativePath` and therefore the `id`. The
  reminder re-appears under the new path on the next scan with default `state`; any
  prior snooze override is not carried across renames (accepted, rare).
- The daemon writes it atomically (temp + rename). The app **watches** this file and
  re-renders; it treats it as read-only.

### Vault-root discovery (chicken/egg)

The daemon must know the active vault before it can scan, including right after login
before the app runs. The app writes the active vault root (+ vault hash + reminder
settings like the date-only default time) to a fixed config path the daemon reads and
watches: `~/.config/eskerra/reminderd.json`. On vault switch the app rewrites it; the
daemon reloads and re-scans.

### Vault / config edge cases (daemon must fail safe)

The daemon must never crash-loop, scan the wrong tree, or fire notifications for a
vault that is not currently active. Required behavior:

- **No active vault** (config absent or has no vault root): daemon idles — no scan, no
  schedule, empty index for no vault. It keeps watching `reminderd.json` and starts
  scanning once a valid vault appears. This is the normal first-run / never-opened-app
  state.
- **Vault path missing** (config points to a path that does not exist or is not a
  directory — unmounted drive, deleted folder): do **not** scan, do **not** clear or
  overwrite the existing index for that vault, do **not** fire notifications. Mark the
  daemon state as "vault unavailable", log it (observability), and retry on the next
  config/watch signal or a slow backoff poll. Preserving the last index avoids losing
  reminder state during a transient unmount; it is rebuilt on next successful scan.
- **Vault switch while daemon is running:** treat exactly like the app's
  session-scoped watcher — bump an internal session id, tear down the old watch +
  scheduled timers, load the new vault's index (keyed by vault hash), full-scan, and
  re-arm. In-flight notifications/actions tagged with the old session are ignored
  (mirrors `vault_watch.rs` stale-session dropping). Each vault has its own index file,
  so switching back is cheap and non-destructive.
- **Invalid `reminderd.json`** (unparseable, missing required fields, or schema
  version mismatch): do **not** crash and do **not** act on partial data. Keep the
  last-known-good config in memory, log the parse failure, and keep watching the file
  so a corrected write recovers automatically. If there is no last-known-good config,
  fall back to the "no active vault" idle state. Config writes from the app should be
  atomic (temp + rename) to avoid the daemon ever reading a half-written file.
- **Daemon restart after the app has not run yet** (e.g. login before the app was ever
  opened, or daemon restarted by systemd): the daemon reads `reminderd.json` if it
  exists. If the app has never written it, there is no vault → idle (above). If it
  exists, the daemon reconstructs state purely from disk: scan the vault, rebuild the
  index, apply missed/grace + overdue rules. Snooze overrides persisted in the index
  survive a restart; if the index is absent or unreadable, it is rebuilt from scratch
  (reminders reappear with default state — acceptable, never a data-loss event because
  the source of truth is the note text). The daemon does not depend on the app being
  alive at any point.

### Missed / grace semantics

Evaluated at scan time and at each minute tick:

- `now < fireAt` → schedule normally.
- `fireAt ≤ now < dueAt` → fire the 5-min notification **immediately, once**.
- `now ≥ dueAt` (we were off when it was due) → mark `due` (counts for dot, shows in
  pane) but **do not** pop a stale OS notification. Document as "missed, surfaced
  in-app only".

**Overdue tokens (explicit rule):** Past, non-struck-through tokens are treated as
overdue reminders. They appear in the Notifications pane and count toward the unread
dot until they are removed / struck through. They do **not** trigger stale OS
notifications when discovered after their due time. This is the same outcome as the
`now ≥ dueAt` case above and applies regardless of how far in the past the token is —
a token authored last week with a past date surfaces in-app immediately on scan, with
no OS popup.

---

## Phases

Each phase is independently shippable and testable. Rust phases reuse the workspace;
TS phases reuse existing pane/editor infra. Tests are mandatory per phase
(Vitest for TS, `cargo test` for Rust) — failing tests block the phase.

### Phase 0 — Spec + ADR + cargo layout decision

**Scope:** This document + an ADR for "separate reminder daemon" (under `specs/adrs/`)
+ decide cargo layout: split `src-tauri` into a `lib` + two `bin` targets (`app`,
`reminderd`) sharing a reminder-core module, **or** a new workspace crate
`crates/eskerra-reminder-core`. Recommendation: a shared **library module/crate** for
token grammar + scanning + index schema, consumed by both the app and the daemon, so
the grammar is ported exactly once on the Rust side.

**Deliverables:** ADR, finalized index/IPC schema, systemd unit + autostart packaging
sketch, observability fields list. No runtime code.

**Risks:** getting the index/IPC schema wrong forces churn later — pin it here.

**LLM advice:** **Claude Opus 4.8, thinking high.** Pure architecture/trade-off work
across an unfamiliar multi-process boundary with hard correctness invariants; this is
the highest-leverage reasoning phase and benefits most from the strongest model.

### Phase 1 — Shared Rust reminder core (pure, no I/O side effects)

**Scope:**
- Port the `dateToken.ts` grammar to Rust (parse/validate, leap-year aware), with a
  test vector shared conceptually with the TS tests (same valid/invalid cases incl.
  `@2026-02-29`, `@…_2560`, and the struck-through `@~~…~~` → no match case).
- Scanner: given file bytes + vault-relative path, return reminder spans (char
  offsets) + parsed datetime, ignoring struck-through tokens.
- Index model + (de)serialization (serde), stable `id` derivation per the
  **Reminder identity** rules (path + normalized token text + occurrence ordinal;
  never offsets), atomic write helper, merge logic (preserve `state`/snooze across
  rescans by `id`).
- Date-only → `dueAt` resolution using the configurable default time.

**Deliverables:** `eskerra-reminder-core` with thorough `cargo test`, including:
identity stability when text above a token is inserted/deleted; correct ordinal
disambiguation of duplicate identical tokens; new-`id`-on-token-edit; struck-through
`@~~…~~` excluded from scan. No watcher, no D-Bus, no real filesystem watching yet
(scanning provided bytes is fine).

**Risks:** identity must be offset-independent (see Reminder identity); the only
residual ambiguity is multiple byte-identical tokens in one file, handled by the
ordinal and, at write time, by Phase 4's unique-match-or-refuse rule.

**LLM advice:** **Claude Sonnet 4.6, thinking medium** for the bulk port (mechanical,
well-specified by `dateToken.ts`), escalate to **Opus 4.8 thinking medium** for the
`id`/merge design (the one subtle part). **Composer 2.5** is acceptable here *if you
want speed on the mechanical port* — it is pure, fully test-guarded Rust with an exact
TS reference, so a cheaper fast model is low-risk; keep Opus for the merge logic.

### Phase 2 — Daemon skeleton: watcher + index production + packaging

**Scope:**
- New binary `eskerra-reminderd`. Reads `~/.config/eskerra/reminderd.json` for vault
  root + settings; watches that config file for live vault switches.
- File watching: extract the reusable parts of `vault_watch.rs` (debounce,
  recommended+poll backends, coarse fallback, ignored-dir filtering) into a shared
  module so the daemon and the app share one watcher implementation. Daemon does an
  initial full scan, then incremental rescans keyed by changed paths.
- Produces/maintains the index cache (atomic writes).
- systemd `--user` unit (`eskerra-reminderd.service`) + autostart; wired into the RPM
  build so packaging installs/enables it. Bump-script alignment if a version string is
  added.

**Deliverables:** daemon that, given a vault, keeps an accurate index updated within
the <1s latency budget on disk changes from any source. No notifications yet.
Must implement and test the **Vault / config edge cases** (no vault, missing path,
vault switch, invalid config, restart-before-app-ran) with their fail-safe behavior,
and use atomic temp+rename for both the index and any app-written config.

**Risks:** double watcher (app + daemon both watching the same vault) — acceptable
(independent processes), but document it and keep both debounced. Watcher extraction
must not regress the app's existing `vault_watch` tests.

**LLM advice:** **Claude Opus 4.8, thinking high.** Touches the most sensitive existing
code (`vault_watch.rs`) under strict invariants (coarse fallback, debounce ceilings,
session scoping, Sentry observability). High blast radius if the extraction regresses
the app watcher — use the strongest model and keep the existing watcher tests green.

### Phase 3 — Scheduler + GNOME D-Bus notifications with actions

**Scope:**
- Scheduler: min-heap / sorted timer of `fireAt` times; sleep-until-next; re-arm on
  index change. Minute-tick to flip `scheduled → due` and update missed/grace state.
- `zbus` client for `org.freedesktop.Notifications`: fire at T-5min with body =
  note title + reminder text context; actions: `snooze-3`, `snooze-1`, `snooze-0`,
  `remove`, plus default action (click). Localized/clear button labels
  ("Remind at T-3 min", …).
- Action handling: snooze-N reschedules a new `fireAt` = `dueAt − N min` (and persists
  the override in the index); `remove` triggers Phase 4 write + closes; default click
  triggers Phase 5 open.
- Missed/grace semantics from the architecture section.
- New deps justification (`zbus`): needed for action buttons + callbacks on GNOME;
  not on app startup path; cannot be deferred (core of requirement 6); Rust required
  (D-Bus, long-lived); risk = D-Bus availability → fall back to click-only
  notification and log; measured via notification-send success/fail counters.

**Deliverables:** real GNOME notifications with working snooze/remove/click on the
reference Fedora/GNOME environment.

**Risks:** D-Bus action callbacks require the sender to stay alive (the daemon does);
notification daemon quirks across GNOME versions; clock changes / suspend-resume
(re-evaluate schedule on wake).

**LLM advice:** **Claude Opus 4.8, thinking high** for the scheduler correctness
(time math, snooze re-arm, suspend/resume, missed handling — easy to get subtly
wrong). For the `zbus` wiring specifically, this is library-API-shaped: **verify the
current `zbus` + `org.freedesktop.Notifications` API against docs** (use the model with
web/doc access) rather than relying on memory, since the API surface and notification
action semantics are version-sensitive.

### Phase 4 — Strikethrough write-back (sole writer) + app→daemon IPC

**Scope:**
- Strikethrough writer that converts the exact token span `@2026-11-27_2300` →
  `@~~2026-11-27_2300~~`, governed by the strict rules below.
- D-Bus service `dev.eskerra.Reminders1` exposing `RemoveReminder(noteUri, id)` so the
  app's "delete from pane" routes here (single writer). Same method backs the OS
  notification `remove` action.

**Write-back safety rules (mandatory — fail closed):**

1. **Re-read + re-scan before writing.** Never write from cached offsets or the index's
   advisory `tokenFrom`/`tokenTo`. Read the current file bytes from disk and re-run the
   scanner to enumerate live tokens and their current spans.
2. **Match by identity, require a unique high-confidence match.** Recompute `id`
   (path + normalized token text + occurrence ordinal) for the freshly scanned tokens
   and find the one equal to the requested `id`. The match must be **unique**. If zero
   match (token already struck, edited, or gone) → no write, resolve the reminder as
   "already removed" and drop it from the index. If more than one candidate could
   correspond (ambiguity from duplicates after concurrent edits) → **do not guess**.
3. **Verify the bytes at the resolved span are exactly the expected token.** Before
   editing, assert the slice `[from, to)` equals the normalized token text. If it does
   not (drift/corruption/encoding surprise) → no write.
4. **Byte-preserving, minimal edit.** Replace only `[from, to)` with the struck form,
   leaving every other byte — including line endings, trailing whitespace, BOM, and
   final-newline state — untouched. No reformatting, no re-serialization of the
   document.
5. **Atomic write.** Write to a temp file in the same directory and `rename` over the
   original, so a reader never sees a partial file and the app's watcher sees one clean
   external edit.
6. **Fail closed → surface, don't guess.** On any of (no unique match, byte mismatch,
   read/write/IO error, ambiguity), the daemon performs **no** write, marks the
   reminder `stale`, and surfaces that state in the index. The app shows the row as
   "could not remove — open the note" (links to the note for manual edit) instead of
   silently dropping it or striking the wrong span. `stale` reminders stop firing OS
   notifications but remain visible until resolved.
7. **No writes to a note with an unsaved in-editor draft are special-cased in the
   daemon** — the daemon only ever rewrites the on-disk file via the atomic path above.
   Reconciliation with an open editor is the app's existing job: the resulting
   `vault-files-changed` event flows through the established conflict/reconcile
   machinery (AGENTS.md *Vault disk sync invariants* + *Note body cache*), which must
   not clobber the user's draft.

**Deliverables:** removing a reminder (from OS notification or app pane) either reliably
strikes the exact token on disk (surviving concurrent edits elsewhere in the file) or
fails closed into a visible `stale` state — never a wrong-span or partial write.

**Risks (highest data-loss surface in the whole plan):** clobbering concurrent edits;
striking the wrong span after offset drift; encoding/line-ending changes. Mitigation:
match by `id` + re-scan at write time; byte-preserving edit; mandatory tests.

**LLM advice:** **Claude Opus 4.8, thinking high — non-negotiable here.** This is the
markdown-integrity / data-loss surface the repo guards most heavily
(`review-markdown-integrity-data-loss-prevention` skill exists for exactly this). Do
**not** use a cheaper model for the write path. After implementation, run the
markdown-integrity review skill over the diff.

### Phase 5 — Click-to-open: launch/focus app, navigate to note + caret

**Scope:**
- Add `tauri-plugin-single-instance` (or equivalent) to the app. Default-action click
  in the daemon spawns `eskerra --open-reminder <noteUri> <caretPos>`; if the app is
  already running, single-instance forwards argv to the live instance.
- App handles the open command: select/open the note, scroll into view, set caret
  **immediately after the token** (reuse `dateTokenAtPosition` to find the token end,
  consistent with the existing date-token click routing in `dateTokenClick.ts` /
  `noteMarkdownPointerLinks.ts`).
- Cold-start path: if the app was not running, it boots, then applies the pending open
  command after vault hydration (respect the first-render-sacred invariant: queue the
  navigation, don't block startup).

**Deliverables:** clicking the OS notification opens the right note at the right caret,
whether or not the app was already running.

**Risks:** focus-stealing/raise behavior on GNOME/Wayland; race between boot hydration
and the queued open command (reuse the existing deferred-restore pattern in
`useInboxShellRestore`).

**LLM advice:** **Claude Sonnet 4.6, thinking medium** for the app-side navigation/caret
(well-trodden editor code with existing helpers), escalate to **Opus 4.8 thinking
medium** for the cold-start ordering vs. the startup-performance invariant. Verify the
`tauri-plugin-single-instance` API against current Tauri 2 docs rather than memory.

### Phase 6 — App side: render reminders in the pane + dot logic

**Scope:**
- App reads + watches the index cache; maps reminders into the Notifications pane,
  interleaved/sorted with existing `SessionNotification`s (extend the source union
  with a `reminder` source; preserve existing dismiss/clear/highlight behavior).
- Click a reminder row → Phase 5 navigation (in-app path, no OS round-trip).
- Delete a reminder row → `RemoveReminder` IPC (Phase 4), **not** a local write.
- **Clear-all (locked decision):** "Clear all" clears **only transient session
  notifications** and never reminders. Removing a reminder mutates note content (the
  strikethrough write) and must be an explicit, per-row action via `RemoveReminder`.
  "Clear all" must therefore skip reminder rows entirely — it neither hides them nor
  calls the daemon. Reflect this in the button's enabled/disabled state (it is enabled
  based on session rows only) and in the pane copy if needed.
- **Dot logic:** compute "has due reminders" = any reminder with `now ≥ dueAt` (or
  reminder-time reached) and not removed. Future reminders excluded. Re-evaluate on a
  minute tick (and on index change). Wire to the existing rail/notifications dot.
- Render struck-through reminders as gone (they leave the index once `removed`).

**Deliverables:** reminders visible in the pane with correct dot behavior; full
in-app lifecycle (view, open, delete) working with the daemon as backend.

**Risks:** mixing reminder rows with transient session rows (dedupe, ordering;
clear-all semantics are locked above). Stale-closure / minute tick correctness (this
repo has a dedicated `review-state-consistency` skill). `stale` reminder rows (failed
removal, Phase 4) must render distinctly and link to the note for manual resolution.

**LLM advice:** **Claude Sonnet 4.6, thinking medium** for the pane rendering/wiring
(matches existing `useSessionNotifications` patterns). Escalate the **dot/minute-tick
+ index-watch** logic to **Opus 4.8 thinking medium** and run the
`review-state-consistency-closure-safety` skill, since timers + watched-file state +
refs are exactly its failure mode.

### Phase 7 — End-to-end, reconcile/data-loss tests, observability, docs

**Scope:**
- Integration tests: token on disk → index → notification fire → snooze → remove →
  strikethrough → index drops it → pane updates → dot clears. Daemon-edits-open-note
  reconcile test. Missed/grace + overdue test. Vault-switch test.
- Write-back fail-closed tests: token already struck/edited/gone before remove (no
  write, resolves as removed); byte mismatch at resolved span (no write, `stale`);
  ambiguous duplicate match (no write, `stale`); duplicate-identical-token ordinal
  disambiguation. Assert no wrong-span and no partial writes in every case.
- Config/vault edge-case tests: no vault idle; missing vault path preserves index and
  does not fire; invalid `reminderd.json` keeps last-known-good; restart-before-app-ran
  rebuilds from disk; clear-all leaves reminder rows untouched.
- Observability: scan duration, reminder counts, notification send success/fail,
  D-Bus unavailability, watcher coarse-invalidation (mirror the app's Sentry
  discipline); add/extend an observability spec.
- Docs: rewrite the "Future reminders (deferred)" section of
  `desktop-date-token.md` to point at this implemented feature; update AGENTS.md
  invariants (new single-writer + daemon-reconcile invariant); packaging docs for the
  systemd unit.

**Deliverables:** green CI, observable daemon, synchronized specs.

**LLM advice:** **Claude Opus 4.8, thinking high** for designing the cross-process
integration + reconcile tests (the hard part is asserting the data-loss invariants),
**Sonnet 4.6 thinking medium** for the observability plumbing and doc updates.

---

## Cross-cutting LLM guidance

- **Default to Claude.** Use **Opus 4.8 (thinking high)** for every phase that touches
  the watcher, time/scheduler math, the strikethrough write path, or cross-process
  invariants (Phases 0, 2, 3, 4, and the test design in 7). These are the
  high-blast-radius, correctness-critical surfaces.
- Use **Sonnet 4.6 (thinking medium)** for the mechanical/well-patterned work (Rust
  grammar port in Phase 1, app pane rendering in Phase 6, navigation in Phase 5, docs
  in 7).
- **Composer 2.5**: only genuinely justified in **Phase 1** (pure, fully test-guarded
  Rust with an exact TS reference) if you want a fast cheap pass on the mechanical
  port. Avoid it on Phases 2–4 (watcher, scheduler, write path) — the data-loss and
  reconcile invariants are unforgiving.
- **GPT models**: optional second opinion / review on the Phase 0 architecture and the
  Phase 4 write-path diff (adversarial review), not as primary implementer, given the
  repo's Claude-Code-centric tooling and skills.
- For any phase that wires an external library (`zbus`/D-Bus in 3,
  `tauri-plugin-single-instance` in 5): **verify the current API against docs/web**
  instead of relying on model memory — these APIs are version-sensitive.

## Open items to confirm during Phase 0

- Exact systemd packaging story in the existing RPM build (enable on install?
  user-service template path).
- Whether the daemon should also own a tiny tray entry, or stay fully headless
  (current plan: fully headless; app launched on click is enough).
- Notification grouping/coalescing policy when many reminders fire close together.
- Settings surface for the date-only default time (09:00) — where it lives in app
  settings and how it reaches `reminderd.json`.
</content>
</invoke>
