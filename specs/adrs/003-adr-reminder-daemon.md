# ADR 003: Separate reminder daemon (`eskerra-reminderd`)

## Status

Accepted — **Phase 0** of [`specs/plans/desktop-reminders-daemon-phased.md`](../plans/desktop-reminders-daemon-phased.md)
(2026-06-06). This ADR locks the architecture decisions, cargo layout, index/IPC
schema, systemd/packaging sketch, observability fields, and the `RemoveReminder`
failure contract **before any runtime code is written**. No code lands in Phase 0.

Subsequent phases (1–7) implement against the contracts pinned here. Changing any
locked schema/IPC/contract field after Phase 0 requires updating this ADR in the same PR.

## Context

The `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` date tokens parsed today by
[`apps/desktop/src/editor/noteEditor/dateToken/dateToken.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateToken.ts)
become **reminders**. The hard requirement is that reminders fire OS notifications and
rewrite notes (strikethrough on removal) **while the app window is closed** — Syncthing,
another editor, or the daemon's own writes all count as triggers, not only app-mediated
edits. This supersedes the "Future reminders (deferred)" section of
[`specs/architecture/desktop-date-token.md`](../architecture/desktop-date-token.md) once shipped.

A Tauri window-close tears down the webview, so a GUI-only solution cannot satisfy the
"works while closed" requirement. Per the AGENTS.md new-process / new-dependency
checklist (AGENTS.md §"When proposing a new … background process"):

1. **Why needed:** reminders must fire and rewrite notes with the app window closed.
2. **On startup path?** No. Separate binary launched by systemd at login; never inside
   the app's sacred first-render path.
3. **Can it be deferred?** The daemon is the feature and cannot be deferred; its *scan*
   is deferred/incremental/debounced and never blocks anything user-facing.
4. **Why Rust:** long-lived filesystem watcher + recurring full-vault scans + D-Bus
   integration — the Rust-justified profile, consistent with the existing desktop native
   design (the app already owns `vault_watch.rs`, `vault_search.rs`, Tantivy, etc.).
5. **Performance risk:** repeated full-vault scans, unbounded watcher batches.
   Mitigated by reusing the proven debounce + coarse-fallback discipline from
   `vault_watch.rs`, incremental rescans keyed by changed paths, and a hard batch ceiling.
6. **How measured:** scan duration + reminder count, watcher detect→index latency
   (<1s budget, same as the app watcher), D-Bus failures and coarse invalidations —
   see **Observability fields** below.

## Decision

### 1. Separate headless daemon is the single owner of writes

A separate headless binary **`eskerra-reminderd`** (systemd `--user` service) is the
**single owner** of vault scanning, scheduling, OS notifications, and **all**
reminder-driven disk writes (the strikethrough rewrite). The Tauri app **reads** the
index and renders; it **never** writes the `~~…~~` mutation locally.

**Single-writer invariant (load-bearing):** deleting a reminder from the app pane calls
the daemon's `RemoveReminder` IPC — the app never strikes the token itself, including
when the daemon is unreachable (see **`RemoveReminder` failure contract**). This keeps
exactly one writer for that mutation and prevents two processes racing on the same bytes.

When the daemon rewrites a note open in the editor, it is by design indistinguishable
from any other external on-disk edit and flows through the existing
`vault-files-changed` → reconcile path (AGENTS.md *Vault disk sync invariants* + *Note
body cache*). The writer does a byte-preserving read-modify-write of the token span only,
so reconcile sees a minimal diff.

### 2. Cargo layout — workspace with a pure shared core crate (LOCKED)

We adopt a **cargo workspace** with a pure shared core crate, rather than a `lib + two
bin` split inside the existing `app` crate.

```
<repo root>/Cargo.toml                       # [workspace] root (new); owns [patch.crates-io]
  apps/desktop/src-tauri/   (crate "app")    # existing Tauri app; gains a dependency on core
  crates/eskerra-reminder-core/              # NEW: pure, no-I/O-side-effect core (Phase 1)
  crates/eskerra-reminderd/                  # NEW: daemon binary (Phase 2+)
```

- **`crates/eskerra-reminder-core`** (Phase 1): token grammar (Rust port of
  `dateToken.ts`), scanner (byte-span producing), index model + serde (de)serialization,
  stable `id` derivation, atomic-write helper, and duplicate-aware merge/state migration.
  **Pure**: no filesystem watching, no D-Bus, no Tauri. It accepts file *bytes* and a
  vault-relative path. Consumed by **both** the app and the daemon so the grammar is
  ported on the Rust side exactly once.
- **`crates/eskerra-reminderd`** (Phase 2+): the daemon binary. Depends on
  `eskerra-reminder-core` + `notify` (watcher) + `zbus` (D-Bus). **Must not** depend on
  `tauri`, `webkit2gtk`, `gtk`, or any GUI stack — keeping the always-on daemon lean.
- The existing **`app`** crate depends on `eskerra-reminder-core` (so the app can resolve
  a live token by the same lookup-then-resolve rule for click-to-open, Phase 5) but
  **does not** depend on `eskerra-reminderd`.

**Why not `lib + two bins` in the `app` crate:** a `reminderd` bin inside the `app`
crate would link `app_lib`, dragging the entire Tauri/webkit2gtk/gtk dependency graph
into the always-on daemon. That bloats the daemon, couples it to the GUI build, and
violates "keep the background process lean." The pure-core crate gives one grammar port,
a slim daemon, and a clean test boundary.

**Migration consequences to handle in Phase 1/2 (not Phase 0):**

- Introducing a workspace root means `[patch.crates-io]` (the vendored `glib` and
  `tauri-plugin-window-state`) must move to the **workspace root `Cargo.toml`**, with the
  vendor paths rewritten to `apps/desktop/src-tauri/vendor/…`. This touches the sensitive
  app build; do it as an isolated, separately-verified step with the app's existing tests
  and a real build green **before** adding daemon code.
- **Version alignment / bump scripts:** the daemon ships in the same RPM as the app and
  must carry a matched version. `scripts/sync-app-version-artifacts-lib.mjs` today sets
  `[package].version` in the app `Cargo.toml` and the `app` package in `Cargo.lock`.
  When the daemon crate is added (Phase 2), either give it `version.workspace = true`
  (workspace-inherited version) **or** extend the sync script to also stamp
  `eskerra-reminderd` in `Cargo.lock` via `applySemverToCargoLockPackageVersion`. Add a
  `scripts/assert-app-versions-align.mjs` check that the daemon version equals the app
  version. This is the "bump-script alignment if a version string is added" item in
  Phase 2.

### 3. Index cache — schema LOCKED

Device-local derived state. Lives in the **app's XDG data dir**, never inside the synced
vault (`~/.local/share/eskerra/reminders/<vault-hash>.json`). Putting it under the vault
would create Syncthing conflicts and violate "source of truth is the note text." One
file per vault (keyed by vault hash) so vault switch-back is cheap and non-destructive.

The daemon writes it atomically (temp + `rename`); the app **watches** it and treats it
as read-only.

**Top-level document:**

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `u32` | Currently **1**. Bump on any breaking change; readers reject unknown major versions and fail safe (treat as absent index). |
| `vaultHash` | `string` | Vault hash this index belongs to (sanity check vs. filename). |
| `vaultRelativeRootMarker` | `string` | Optional, informational; never used to drive writes. |
| `generatedAtMs` | `i64` | Wall-clock ms when this index snapshot was written. |
| `reminders` | `Reminder[]` | See below. |

**`Reminder` entry:**

| Field | Type | Purpose / rules |
|---|---|---|
| `id` | `string` | Stable identity = `hash(vaultRelativePath \0 normalizedTokenText \0 occurrenceOrdinal)`. **Never** derived from byte offsets. See *Reminder identity*. |
| `noteUri` | `string` | Routing handle for IPC + open. |
| `vaultRelativePath` | `string` | Path relative to vault root (survives relocation/sync). |
| `normalizedTokenText` | `string` | Canonical `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` (parser-normalized, not raw bytes). |
| `occurrenceOrdinal` | `u32` | 0-based index among **identical** tokens in the file, document order. A *tie-break only*; never trusted blindly (ordinals drift on insert/delete above). |
| `dueAtMs` | `i64` | The reminder time itself. Date-only tokens resolve via the configurable default time (default 09:00 local). |
| `fireAtMs` | `i64` | T-5min lead, or a snooze override. Drives the scheduler. |
| `state` | enum | `scheduled` \| `due` \| `notified` \| `stale`. (`removed` is transient — a removed reminder is **dropped** from the index, never persisted.) |
| `lastNotifiedMs` | `i64?` | Per-`fireAt` fire guard; prevents double-fire across re-arm / reconcile / resume. |
| `tokenByteFrom` | `u64` | **Byte** span start (UTF-8 byte index). Last-scan only; the **only** span class allowed for write-back. Re-derived by re-scan before any write. |
| `tokenByteTo` | `u64` | Byte span end (UTF-8 byte index). |
| `uiCaretHint` | `object?` | **Advisory** editor-facing position from last scan (e.g. `{ line, col }` or char offset). Scroll guess only; **never** a write position and **never** fed to CodeMirror as authoritative. |
| `contextAnchor` | `string` | Hash of the token's **containing line with the token text masked out**. Re-finds *this* occurrence by content after ordinals shift. Matching aid, not identity. |
| `duplicateCount` | `u32` | Count of byte-identical tokens in the file at last scan. A change between scan and write signals possible ordinal drift. |
| `scanFingerprint` | `string` | **Authoritative content hash** (SHA-256 of file bytes) at the scan that produced this entry. `len`+`mtime` may be kept as an optional perf pre-check only — **never** accepted as proof. "Provably unchanged" always means recomputed content hash == stored `scanFingerprint`. |

**Byte spans vs. UI positions must never be confused.** `tokenByteFrom`/`tokenByteTo`
are UTF-8 byte indexes and are the sole spans used for disk write-back; the byte span is
re-derived by re-scanning before every write (Phase 4) and is never the basis of
identity. `uiCaretHint` is advisory UI state the app converts to its editor model itself;
the daemon never converts or uses a UI position for slicing.

### 4. Reminder identity & merge — LOCKED rules

Identity is **offset-independent**: `id = hash(vaultRelativePath \0
normalizedTokenText \0 occurrenceOrdinal)`. Consequences:

- Editing text **elsewhere** in the file changes no `id` (path/token/ordinal unaffected)
  — `state`/snooze survive rescans.
- Editing the **token text itself** mints a new `id`; old reminder vanishes, new one
  appears `scheduled`. Correct: a changed time is a different reminder.
- Renaming/moving a note changes `vaultRelativePath` → new `id`; reminder reappears under
  the new path with default state (prior snooze not carried — accepted, rare).

**Duplicate identical tokens** are the only residual ambiguity. They are matched by
`contextAnchor`, ordinal only as a tie-break, and **any residual ambiguity fails closed**
on *both* critical paths:

- **Merge / state migration** (rescan → new index): classify each content key
  (`noteUri` + `normalizedTokenText`) as duplicate (>1 on either side) or non-duplicate
  **first**. Exact-`id` carry is allowed **only** for non-duplicate content keys. For
  duplicate content keys, migrate `state`/snooze/`lastNotifiedMs`/`stale` **only** by
  unique `contextAnchor`, or by ordinal **only** when the recomputed content hash equals
  the stored `scanFingerprint`. Ambiguous → do **not** migrate; recompute affected
  candidates as **fresh** reminders. (Full rules: plan §*Index merge / state migration*.)
- **Write-back** (Phase 4): look up the stored entry by `id` first; re-read+re-scan;
  resolve the live token by `normalizedTokenText` + unique `contextAnchor` (ordinal only
  when content hash matches `scanFingerprint`); ambiguity → **`stale`**, write nothing.

Never carry/select by ordinal-derived `id` alone. Failing safe means: merge → fresh
reminders; write → `stale`.

### 5. Vault-root discovery & config — LOCKED

The app writes the active vault root + vault hash + reminder settings (e.g. the date-only
default time) to a fixed config path the daemon reads and **watches**:
**`~/.config/eskerra/reminderd.json`**. On vault switch the app rewrites it (atomically,
temp + rename); the daemon reloads and re-scans.

`reminderd.json` (LOCKED shape, `schemaVersion: 1`):

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `u32` | Currently **1**. |
| `vaultRoot` | `string?` | Absolute path of the active vault, or absent/null = no active vault. |
| `vaultHash` | `string?` | Hash used to key the index file. |
| `dateOnlyDefaultTime` | `string` | `"HH:MM"` local; default `"09:00"`. |
| `leadMinutes` | `u32` | OS-notification lead; default **5**. |

**Daemon fail-safe behavior (no crash-loop, never scan/notify the wrong tree):**

- **No active vault** (config absent / no `vaultRoot`): idle — no scan, no schedule,
  empty index; keep watching `reminderd.json`; start scanning once a valid vault appears.
- **Vault path missing** (points at a nonexistent / non-dir path — unmount, deletion):
  do **not** scan, do **not** clear/overwrite the existing index, do **not** notify.
  Mark "vault unavailable", log it, retry on next config/watch signal or slow backoff.
- **Vault switch while running:** bump an internal session id, tear down old watch +
  timers, load the new vault's index (by hash), full-scan, re-arm. In-flight
  notifications/actions tagged with the old session are ignored (mirrors `vault_watch.rs`
  stale-session dropping).
- **Invalid `reminderd.json`** (unparseable / missing required fields / version
  mismatch): do **not** crash or act on partial data; keep last-known-good config in
  memory; keep watching so a corrected write recovers. No last-known-good → idle.
- **Restart before the app ever ran:** read `reminderd.json` if present; if never
  written → idle. If present, reconstruct purely from disk: scan, rebuild index, apply
  missed/grace + overdue rules. Snooze overrides persisted in the index survive restart;
  absent/unreadable index is rebuilt from scratch (reminders reappear with default state
  — never data loss, the note text is the source of truth). The daemon never depends on
  the app being alive.

### 6. OS notifications — native D-Bus (`zbus`), LOCKED

Native **`org.freedesktop.Notifications`** via D-Bus (`zbus`), with action buttons +
callbacks. `tauri-plugin-notification` is insufficient for persistent action buttons on
Linux. Actions: `snooze-3`, `snooze-1`, `snooze-0` ("Remind at T-3 / T-1 / at time"),
`remove`, plus default action (click). Suspend/resume handled via `PrepareForSleep` on
`org.freedesktop.login1` (same `zbus` stack), with a periodic wall-clock reconciliation
fallback. The three evaluation contexts (scheduled-fire execution, resume catch-up,
discovery) and snooze-boundary semantics are pinned in the plan §*Missed / grace
semantics* and §*Snooze action handling* — this ADR does not restate them. `zbus` API is
version-sensitive: Phase 3 must verify against current docs, not model memory.

### 7. IPC — LOCKED interface

D-Bus service owned by the daemon:

- **Bus name / interface:** `dev.eskerra.Reminders1`
- **Object path:** `/dev/eskerra/Reminders1`
- **Method:** `RemoveReminder(IN s noteUri, IN s id, OUT s result)`
  - `result` ∈ `{ "removed", "stale" }`.
  - **The method takes only the stable `id` (+ `noteUri` for routing) — never a byte
    span (`tokenByteFrom`/`tokenByteTo`), never a `uiCaretHint`, never any offset.** The
    caller cannot dictate *where* to write; the daemon alone resolves the byte span by
    re-scanning at write time. Any position the app holds is advisory UI state and is
    never sent over IPC, so a stale offset can never drive a write.
  - Backs both the app pane's "delete" and the OS notification `remove` action.

**Click-to-open is process spawn, not D-Bus** (Phase 5): the daemon spawns
`eskerra --open-reminder <noteUri> <reminderId>` with an **optional**
`--ui-caret-hint <pos>`. `tauri-plugin-single-instance` forwards argv to a running
instance, or the app cold-starts and applies the open after vault hydration (respecting
the first-render-sacred invariant). The app resolves the live token by the same
lookup-then-resolve rule as the writer; a daemon byte span is **never** fed to CodeMirror
as a position.

### 8. `RemoveReminder` failure contract — LOCKED (the highest-risk Phase 0 item)

The full result space of removal, pinned so no implementer is ever tempted into a
local-write fallback:

| Outcome | Meaning | Who decides | Effect |
|---|---|---|---|
| **`removed`** | Token resolved to exactly one live span (or zero-match: already struck/edited/deleted, or no index entry for `id`). | Daemon | Daemon strikes the token (or no-op for zero-match) and drops the reminder from the index. Zero-match is a *success-equivalent*, not an error. |
| **`stale`** | Daemon **received** the request but **refused to write safely**: ambiguous duplicate resolution, byte mismatch at the resolved span, IO error, or any case where it cannot identify *exactly one* correct span. | Daemon | **No write.** Daemon records `stale` in the index. App shows "could not remove — open the note" (links to note). `stale` reminders stop firing OS notifications but stay visible until resolved. |
| **`remove-unavailable`** | Daemon **could not be reached at all**: not running, `dev.eskerra.Reminders1` not registered, call timeout, or any transport-level bus error — i.e. the D-Bus method call failed *before* the daemon evaluated anything. | **App only** | **Never** a local strikethrough. **Never** recorded as daemon `stale` (an unreachable daemon by definition produced no `stale` entry). App keeps the row visible & active (note unchanged on disk, still firing per schedule), renders a **Retry** affordance + **Open note** fallback, and **may** best-effort `systemctl --user start eskerra-reminderd` off the UI thread, then retry. App-local UI state only; never written to the daemon-owned index; clears automatically on a successful retry. |

This is the single highest-risk omission the plan calls out: an unhandled transport error
is exactly the gap that tempts a local-write fallback and silently breaks the
single-writer invariant. `stale` ("received but unsafe") and `remove-unavailable`
("never reached") must stay distinct in code, copy, and tests. Full rules:
plan §Phase 4 *Write-back safety rules* + *IPC-unavailable contract*.

### 9. systemd unit + autostart / packaging sketch

systemd `--user` service so the daemon outlives the GUI window and starts at login.

```ini
# eskerra-reminderd.service  → installed at /usr/lib/systemd/user/eskerra-reminderd.service
[Unit]
Description=Eskerra reminder daemon
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/eskerra-reminderd
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Packaging (RPM target is already configured in `tauri.linux.conf.json`):

- Install the `eskerra-reminderd` binary to `/usr/bin/eskerra-reminderd` and the unit to
  `/usr/lib/systemd/user/eskerra-reminderd.service` via the Tauri/RPM bundle file list
  (extend the existing Linux packaging the way `linux/com.eskerra.desktop.desktop` is
  shipped).
- **Enablement:** ship a systemd user **preset** (e.g.
  `/usr/lib/systemd/user-preset/80-eskerra-reminderd.preset` → `enable
  eskerra-reminderd.service`) so it is enabled per-user on first login, **or** have the
  app enable+start it on first run (`systemctl --user enable --now eskerra-reminderd`).
  The app's best-effort `systemctl --user start` recovery path (failure contract row 3)
  also covers the "installed but not yet running" case.
- Exact RPM scriptlet wiring (`%systemd_user_post` vs. preset vs. app-driven enable) is
  an **open item** to finalize in Phase 2 packaging (see plan *Open items*).

### 10. Observability fields (Phase 0 list; Phase 7 turns these into Sentry runbooks)

Mirror the existing Sentry discipline of
[`specs/observability/desktop-vault-watch-coarse-alert.md`](../observability/desktop-vault-watch-coarse-alert.md):
non-PII hashes only, a stable `obs_surface`, a per-lifecycle session id, and a guardrail
that any rename of a message/tag updates the runbook in the same PR.

Common tags (where applicable): `obs_surface=reminderd` (daemon) or
`obs_surface=reminders` (app side), `reminder_session_id=<uuid>` (new per vault-open /
watcher lifecycle), `vault_root_hash=<non-PII hash>`.

Daemon events:

| Event | Key tags / extras |
|---|---|
| `eskerra.reminderd.scan_completed` | extras: `scan_duration_ms`, `reminder_count`, `changed_paths_count`, `full_scan` (bool) |
| `eskerra.reminderd.watch_coarse_invalidation` | tag `coarse_reason` (parallels the app's watcher coarse alert) |
| `eskerra.reminderd.watch_backend_error` | tag `backend=<recommended\|poll>`; raw error in extras only |
| `eskerra.reminderd.notification_send` | tag `result=<sent\|failed>`; `failure_reason` in extras |
| `eskerra.reminderd.dbus_unavailable` | tag `surface=<notifications\|login1\|service_register>` |
| `eskerra.reminderd.remove_result` | tag `result=<removed\|stale>`; on `stale`, tag `stale_reason=<ambiguous\|byte_mismatch\|io>` |
| `eskerra.reminderd.write_failed` | IO/atomic-write failure on the strikethrough path |
| `eskerra.reminderd.suspend_resume_reeval` | extras: `fired_count`, `downgraded_overdue_count`, `login1_available` (bool) |
| `eskerra.reminderd.config_invalid` | tag `reason=<parse\|missing_field\|version>` (kept last-known-good) |
| `eskerra.reminderd.vault_unavailable` | vault path missing/unmounted; index preserved |

App-side events:

| Event | Key tags / extras |
|---|---|
| `eskerra.desktop.reminder_remove_unavailable` | transport failure rate; tag `transport_error=<no_service\|timeout\|bus_error>` |
| `eskerra.desktop.reminder_remove_restart_attempt` | tag `outcome=<started\|failed\|skipped>` (best-effort `systemctl --user start`) |
| `eskerra.desktop.reminder_index_read_failed` | index file unreadable / schema-version mismatch on the app reader |

Latency budget to alert on (Phase 7): disk change → index update **< 1s** (same budget as
the app watcher).

## Consequences

- **Positive:** one Rust grammar port (shared core), a lean daemon decoupled from the GUI
  build, a single writer for the strikethrough mutation, and a fully-pinned schema/IPC/
  failure surface so Phases 1–7 implement against fixed contracts instead of ad hoc
  recollection.
- **Cost / risk introduced now:** the workspace migration must relocate
  `[patch.crates-io]` and rewrite vendor paths against the **sensitive app build**, and
  the version/bump tooling must learn about the daemon crate. Both are explicitly scoped
  to Phase 1/2 as isolated, separately-verified steps with the app's existing tests green
  first — they are not done in Phase 0.
- **Accepted trade-offs:** double watcher (app + daemon both watch the vault) — acceptable
  for independent processes, both debounced; snooze override not carried across a note
  rename (rare); fully headless daemon (no tray) for now.
- **Locked, do not silently change:** the index schema (§3), `reminderd.json` shape (§5),
  the `dev.eskerra.Reminders1` interface (§7), and the three-outcome `RemoveReminder`
  failure contract (§8). Any change updates this ADR in the same PR.

## Open items deferred past Phase 0 (tracked in the plan)

- Exact systemd enablement story in the RPM build (preset vs. `%systemd_user_post` vs.
  app-driven enable) — Phase 2.
- Whether the daemon owns a tiny tray entry, or stays fully headless (current decision:
  headless).
- Notification grouping/coalescing policy when many reminders fire close together.
- Settings surface for the date-only default time (09:00) and how it reaches
  `reminderd.json`.

These do **not** block any locked contract above; they are packaging/UX refinements.
