# Desktop reminders — phased plan (daemon-owned, Rust-level vault monitoring)

Status: **Phase 0 complete** (2026-06-06) — architecture, cargo layout, index/IPC
schema, systemd/packaging sketch, observability fields, and the `RemoveReminder` failure
contract are locked in [ADR 003](../adrs/003-adr-reminder-daemon.md). Phases 1–7 not yet
implemented. Supersedes the "Future reminders (deferred)" section of
[`specs/architecture/desktop-date-token.md`](../architecture/desktop-date-token.md)
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
                    │    - RemoveReminder(noteUri, id) ◀── app    │
                    │    - signal/launch app on click            │
                    └──────────────────────────────────────────┘
                                   │ launch/focus + open(uri, reminderId)
                                   ▼
                    ┌──────────────────────────────────────────┐
                    │  eskerra app (Tauri)                       │
                    │   - reads index cache, watches it          │
                    │   - renders reminders in Notifications pane │
                    │   - dot logic (due vs future, minute tick) │
                    │   - delete-from-pane → RemoveReminder()     │
                    │   - single-instance: open(uri,id) → editor  │
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
`RemoveReminder(noteUri, id)`. This keeps one writer for that mutation and avoids two
processes racing on the same bytes.

**Removal IPC never accepts byte ranges.** `RemoveReminder` takes only the stable
reminder `id` (plus `noteUri` for routing) — never a byte span (`tokenByteFrom`/
`tokenByteTo`), a `uiCaretHint`, or any offset. The caller cannot dictate *where* to
write; the daemon alone resolves the byte span by re-scanning at write time (Phase 4).
Any position the app holds is advisory UI state and is never sent over IPC, so a stale
offset can never drive a write.

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
  | `removed` | `stale`), `lastNotifiedMs`.
- **Byte spans vs. UI positions (must not be confused):** the scanner records the
  token's **byte span** `tokenByteFrom`/`tokenByteTo` (UTF-8 byte indexes into the
  file). These are the **only** spans the daemon may use for disk write-back. Any
  editor-facing position is stored separately and named `uiCaretHint` — an **advisory
  UI position**, last-scan only, never a write position. The app converts a byte span
  to its editor position model itself (Phase 5); the daemon never converts or uses UI
  positions for slicing. Even the byte span is re-derived by re-scanning before any
  write (Phase 4) and is never the basis of identity.

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
  the same file**, assigned in document order at scan time. It is a *primary*
  disambiguator for duplicate identical tokens (e.g. two `@2026-11-27_2300` lines),
  but it is **not sufficient on its own**: inserting or deleting another identical
  token *above* the target renumbers the later ordinals, so an ordinal captured at
  scan time can silently point at the wrong occurrence after a concurrent edit. The
  ordinal therefore must never be trusted blindly at write time; it is always
  cross-checked against the duplicate-safety anchor below.

**Duplicate-safety anchor (stored alongside `id`, used only for safe matching, never
for identity).** For each reminder the index also stores:

- `contextAnchor` — a hash of the token's **containing line** with the token text
  itself masked out (so it is stable across snooze/state changes but distinct between
  two duplicate tokens that live on different lines / in different surrounding text).
  This lets the writer re-find *this* occurrence by content rather than by position
  even after ordinals shift.
- `duplicateCount` — the number of byte-identical tokens in the file observed at the
  last scan. A change in this count between scan and write is a positive signal that
  ordinals may have drifted.
- `scanFingerprint` — the **authoritative content hash** of the file bytes captured at
  the scan that produced this reminder, recording the exact file content the
  ordinal/anchor were derived against. It **must** be a content hash (e.g. SHA-256 of
  the file bytes). `len`+`mtime` may be kept only as an **optional performance
  pre-check / cache-invalidation hint** — used to skip recomputing the hash when they
  are unchanged — but it is **never** accepted as proof on its own. "Provably unchanged"
  always means the recomputed content hash equals the stored `scanFingerprint`. This is
  load-bearing: an external editor or Syncthing can preserve `mtime` or make a
  same-length edit above the target, so trusting `len`+`mtime` would let the daemon
  treat a drifted ordinal as authoritative and strike the wrong occurrence.

Consequences and rules:
- Editing text **elsewhere** in the file does not change any `id` (path, token text,
  and ordinal are all unaffected) — the reminder's `state`/snooze survive rescans.
  (`contextAnchor`/`scanFingerprint` may update on rescan; that is fine — they are
  matching aids, not identity.)
- Editing the **token text itself** (date/time) yields a new `id`; the old reminder
  vanishes from the scan and the new one appears `scheduled`. This is correct: a
  changed time is a different reminder.
- **Duplicate identical tokens are matched by `contextAnchor`, with the ordinal only
  as a tie-break — and any residual ambiguity fails closed.** At write time the daemon
  re-scans and resolves the target by `contextAnchor`. If exactly one live token has a
  matching `contextAnchor`, that is the span. If the surrounding lines are themselves
  identical (so `contextAnchor` does not uniquely separate the duplicates) **and**
  `duplicateCount` or the set of ordinals has changed since `scanFingerprint`, the
  ordinal may have drifted and the daemon **must not** guess: it refuses the write and
  marks the reminder `stale` (see Phase 4). Only when the anchor uniquely identifies
  the occurrence — or the file is provably unchanged (the recomputed content hash equals
  the stored `scanFingerprint`) so the ordinal is still authoritative — does the write
  proceed.
- Renaming/moving a note changes `vaultRelativePath` and therefore the `id`. The
  reminder re-appears under the new path on the next scan with default `state`; any
  prior snooze override is not carried across renames (accepted, rare).
- The daemon writes it atomically (temp + rename). The app **watches** this file and
  re-renders; it treats it as read-only.

### Index merge / state migration (rescan → new index)

When a scan produces a fresh token set, the daemon merges the **prior** index into it
to carry forward mutable state (`state`, snooze override / `fireAtMs`, `lastNotifiedMs`,
`stale`). Because `id` embeds `occurrenceOrdinal`, carrying state **by `id` alone is
unsafe for duplicate identical tokens**: inserting/deleting an identical token above one
of them renumbers ordinals, mints new `id`s on the next scan, and a naive `id`-keyed
merge would move a snooze/`stale`/`notified` state to the wrong line or silently reset
the real reminder. The write-time `contextAnchor` rules guard *writes only*; merge needs
its own duplicate-aware rules. The merge is therefore:

0. **Classify each content key as duplicate or non-duplicate first.** A **duplicate
   content key** is a `noteUri` + `normalizedTokenText` pair that appears **more than
   once** in *either* the prior index *or* the fresh scan. Everything else is a
   **non-duplicate content key**. This classification gates which carry rule applies and
   must be computed before any state is migrated, because the duplicate hazard exists
   whenever the count is >1 on either side (an insert makes the fresh side a duplicate; a
   delete makes the prior side a duplicate).
1. **Exact `id` carry — non-duplicate content keys only.** If a prior entry's `id` still
   exists in the fresh scan **and its content key is non-duplicate on both sides**, carry
   its `state`/snooze/`lastNotifiedMs` across unchanged. This blind, automatic carry is
   the common case (a unique token, including the edit-elsewhere case). It must **not**
   be applied to a duplicate content key: there, the same ordinal-derived `id` can now
   refer to a *different* occurrence (e.g. inserting an identical token above ordinal-0
   leaves the old ordinal-0 `id` present but attached to the new line), so exact-`id`
   equality alone is not proof of the same occurrence.
2. **Duplicate content keys → never carry by ordinal-derived `id` alone; require
   corroboration.** For a duplicate content key, an exact `id` match is **not** sufficient
   by itself. `state`/snooze/`lastNotifiedMs`/`stale` may be migrated **only** if one of:
   - the prior entry's `contextAnchor` **uniquely** matches exactly one live candidate
     (migrate to that candidate's new `id`), **or**
   - the recomputed content hash equals the stored `scanFingerprint`, proving the file is
     byte-for-byte unchanged so the ordinal — and thus the ordinal-derived `id` — is still
     authoritative.
   If neither holds (the duplicate content key changed and `contextAnchor` is not unique),
   do **not** migrate state to any candidate — recompute the live reminders fresh (rule 6).
3. **Lost `id` → recollect candidates by content.** If a prior entry's `id` is absent
   from the fresh scan, collect live candidates by `noteUri` + `normalizedTokenText`
   (the same content key the writer uses). These are the possible new homes for the old
   state.
4. **Unique `contextAnchor` → migrate.** If exactly one live candidate has the same
   `contextAnchor` as the prior entry, migrate `state` / snooze (`fireAtMs`) /
   `lastNotifiedMs` to that candidate's new `id`.
5. **Ordinal only when the content hash matches.** Use `occurrenceOrdinal` to map
   old→new state **only** when the recomputed content hash equals the stored
   `scanFingerprint` (the file is byte-for-byte unchanged, so ordinals are still
   authoritative). A matching `len`+`mtime` is **not** sufficient — it is only an
   optional pre-check before hashing. If the content hash differs (or cannot be
   confirmed), the ordinal is not trusted for migration.
6. **Ambiguous → fail safe, do not migrate.** If duplicate insert/delete or identical
   surrounding context makes the mapping ambiguous (multiple candidates share the
   `contextAnchor`, or the anchor cannot separate duplicates and
   `duplicateCount`/`scanFingerprint` changed), do **not** migrate `state` / snooze /
   `notified` / `stale` to any candidate. Treat the affected live candidates as **fresh
   reminders** recomputed from the current time (default `state`, schedule per the
   missed/grace discovery rules) rather than risk attaching stale state to the wrong
   line. Only mark an old entry `stale`/ambiguous if needed for user visibility (e.g. it
   had a pending `stale` removal worth surfacing); never silently move it onto a
   mismatched occurrence.

This keeps the safety budget symmetric with write-back: when duplicates make identity
uncertain, the system prefers a clean re-derivation over a wrong-line state carry.

### Vault-root discovery (chicken/egg)

The daemon must know the active vault before it can scan, including right after login
before the app runs. The app writes the active vault root (+ vault hash + reminder
settings like the date-only default time) to a fixed config path the daemon reads and
watches: `~/.config/eskerra/reminderd.json`. The daemon watches this file for **both**
vault-root changes **and** settings-only changes (the file is the same source for both).
On vault switch the app rewrites it; the daemon reloads and re-scans. On a **settings-only
change** (same `vaultRoot`/`vaultHash`, but e.g. a changed date-only default time) the
daemon reloads config and re-derives the affected reminders **without** a vault switch —
see *Settings-only config change* below.

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
- **Settings-only config change while daemon is running (no vault switch):** the config
  file changes but `vaultRoot`/`vaultHash` are unchanged — only a setting like the
  date-only default time differs. This is **not** a vault switch (do **not** bump the
  session id or tear down the index), but it **must** re-derive config-dependent fields,
  because otherwise unchanged `@YYYY-MM-DD` tokens keep stale `dueAtMs`/`fireAtMs`
  indefinitely. On such a change the daemon:
  1. **Reloads config** and detects that the date-only default time (or any other
     `dueAt`-affecting setting) changed.
  2. **Re-derives `dueAtMs` and `fireAtMs` for every date-only token** (`@YYYY-MM-DD`,
     no `_HHMM`) in the **active** vault, using the new default time. This needs **no**
     token-text change and **does not change reminder `id`s** (`id` is path + normalized
     token text + ordinal — none depend on the default time), so existing reminders keep
     their identity and merge cleanly: the same date-only `id` simply gets new
     `dueAtMs`/`fireAtMs`.
  3. **Treats the new `dueAtMs`/`fireAtMs` as a schedule change** for each re-derived
     reminder: re-evaluate its state from the new times and **reset/recompute the mutable
     notification state** (`state`, `lastNotifiedMs`, any per-`fireAt` fire-event id) so a
     prior `notified`/`lastNotifiedMs` for the **old** time can **never** suppress the new
     fire. A reminder already notified at the old 09:00 must still fire at, say, a new
     08:00 (or be classified per the missed/grace discovery rules for the new time).
  4. **Re-arms the scheduler** from the recomputed `fireAt`s (drop the stale timers, arm
     the new ones).
  - **Explicit timed tokens `@YYYY-MM-DD_HHMM` are unaffected** by a date-only default
    time change — their `dueAt` comes from the token itself, so their `dueAtMs`/`fireAtMs`
    and notification state are left untouched (no spurious re-fire). Only date-only tokens
    are re-derived.
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

Three evaluation contexts must be kept distinct — they have **different** outcomes for
`now ≥ dueAt`, and conflating them is the snooze-0 bug:

1. **Scheduled-fire execution** — the scheduler's own timer event firing for a
   reminder that was already scheduled (its `fireAt` known to a running daemon before
   `fireAt` arrived). This *executes* a fire.
2. **Resume catch-up** — on the `PrepareForSleep(false)` wake edge, re-evaluating a
   reminder **that was already scheduled before suspend** and whose `fireAt` elapsed
   *while suspended*. This is a deferred scheduled fire, **not** discovery: it *executes*
   a fire once if still within the grace window (rules below), so a brief laptop suspend
   does not silently downgrade an armed reminder to an in-app overdue row.
3. **Discovery on scan / restart / minute-tick** — the daemon first learning a
   reminder's state by reading disk (initial scan, vault switch, daemon restart, or a
   stale catch-up scan). This *classifies* state; it does not resurrect missed OS popups.
   Resume is **not** in this set.

**Scheduled-fire execution (timer event for an already-scheduled reminder):**

- Fires the OS notification **once** when its `fireAt` is reached, including the
  intentional at-time case. A snooze-0 sets `fireAt = dueAt` on purpose, so the
  scheduled fire must pop **at** `dueAt`, not be swallowed as overdue.
- **Exact-at-time case:** if a scheduled fire event reaches `now == dueAt` with
  `fireAt == dueAt` (snooze-0), fire once, record `lastNotifiedMs`, then mark
  `due`/`notified` as appropriate. This is an explicit *fire*, not an overdue
  suppression.
- **Scheduler-late tolerance:** to tolerate timer wakeup jitter, a scheduled fire still
  executes when `now ≥ fireAt && now ≤ dueAt + schedulerGraceMs`, **only** for a
  reminder that was scheduled before `dueAt` and has **not** already fired for that
  `fireAt`. `schedulerGraceMs` is a small bound (e.g. a few seconds). Beyond that
  window the event is treated as a missed scheduled fire and downgraded to in-app
  discovery (no late OS popup).
- **Duplicate / late-fire prevention:** each fire is guarded by `lastNotifiedMs` (or an
  equivalent per-`fireAt` fire-event id). A reminder never fires twice for the same
  `fireAt`: re-arming, reconcile ticks, and resume re-evaluation all check this before
  firing.

**Resume catch-up (wake edge re-evaluation of already-scheduled reminders):**

- Applies **only** to reminders that were **already scheduled before suspend** and whose
  `fireAt` elapsed *while the system was suspended*. It does **not** apply to reminders
  first discovered on the wake-edge scan — those follow the discovery rules below.
- On resume, if `now ≥ fireAt && now ≤ dueAt + schedulerGraceMs` and the reminder has
  **not** already fired for that `fireAt` (guarded by `lastNotifiedMs` / per-`fireAt`
  fire-event id), fire the OS notification **once**. This is the deferred scheduled fire
  executing late on wake (covers snooze-0 / at-time across a short suspend).
- If `now > dueAt + schedulerGraceMs` (the fire elapsed beyond the grace window during a
  longer suspend), do **not** pop a stale OS notification — mark `due`/overdue **in-app
  only**, exactly like an overdue row.

**Discovery on scan / restart / minute-tick (classification only):**

- `now < fireAt` → schedule normally (arms a future scheduled-fire event).
- `fireAt ≤ now < dueAt` → the daemon was off through the T-5min lead but it is still
  before the due time → fire the 5-min notification **immediately, once** (guarded by
  `lastNotifiedMs`).
- `now ≥ dueAt` and the reminder is **first discovered here** (fresh scan, daemon
  restart, or vault switch, with no prior scheduled fire executed for it) → mark `due`
  (counts for dot, shows in pane) but **do not** pop a stale OS notification. "Missed,
  surfaced in-app only." This suppression applies to *stale discovery*, never to a live
  scheduled fire or a **resume catch-up** of an already-scheduled reminder (both above).

**Overdue tokens (explicit rule):** Past, non-struck-through tokens are treated as
overdue reminders. They appear in the Notifications pane and count toward the unread
dot until they are removed / struck through. They do **not** trigger stale OS
notifications when *discovered* after their due time. This is the discovery-context
`now ≥ dueAt` case above and applies regardless of how far in the past the token is —
a token authored last week with a past date surfaces in-app immediately on scan, with
no OS popup. It does **not** override a snooze-0 scheduled fire executed by a running
daemon.

### Snooze action handling (including expired snooze)

A snooze action arrives from a still-visible OS notification. Because GNOME can leave a
notification on screen well past T-3 / T-1 / at-time, the action may be chosen when its
target fire time is already in the past. The action must never move a reminder backwards
in time, immediately re-pop a *re-snoozed future* notification, or loop. The two
relative snoozes (snooze-3 / snooze-1) and the at-time snooze (snooze-0) have **distinct**
outcomes at the boundary `now == dueAt`, so they are specified separately. Rules:

1. **Compute the target.** A snooze-N action computes `targetFireAt = dueAt − N min`
   (snooze-3 → `dueAt − 3min`, snooze-1 → `dueAt − 1min`, snooze-0 → `dueAt`).
2. **Future target → schedule normally.** If `targetFireAt > now`, persist the snooze
   override (`fireAt = targetFireAt`) in the index and arm that future scheduled fire
   like any other (it later fires via *scheduled-fire execution*, guarded by
   `lastNotifiedMs`). This is the normal path for snooze-3 / snooze-1 chosen before
   `dueAt − N min`, and for snooze-0 chosen before `dueAt` (rule 4).
3. **snooze-3 / snooze-1 with `targetFireAt ≤ now` → expired no-op.** A *relative* snooze
   whose target is already in the past is **expired**. It must **not** fire another OS
   notification, must **not** loop, and must **not** move the reminder backwards in time
   (it never rewrites `fireAt` to a past instant). The reminder keeps its current
   `state`; the only side effect is closing/dismissing the OS notification per GNOME
   action behavior. Nothing alarming is surfaced. (snooze-0 is **not** covered by this
   rule — see rules 4–6.)
4. **snooze-0 with `now < dueAt` → schedule the at-time fire.** Persist
   `fireAt = dueAt` and arm the at-time scheduled fire (rule 2 with `N = 0`). It later
   fires exactly at `dueAt` via the *scheduled-fire execution* exact-at-time rule.
5. **snooze-0 with `now == dueAt` → fire once now (NOT a no-op).** This is the explicit
   exact-at-time case: fire the OS notification **immediately, once** through the
   *scheduled-fire execution* / exact-at-time path, guarded by `lastNotifiedMs` (or a
   per-`fireAt` fire-event id) so it cannot double-fire. `targetFireAt == now` here is a
   deliberate at-time fire, **not** an expired action — do not close without firing.
6. **snooze-0 with `now > dueAt` → expired no-op.** Past the due time the at-time fire is
   genuinely missed: do **not** resurrect a stale OS notification, keep the reminder
   `due` **in-app only**. It behaves like the relative expired case (rule 3).
7. **At/after due time, in-app fallback.** When a snooze action is expired (rule 3, or
   rule 6 for snooze-0 past `dueAt`), the reminder remains (or remaps) to `due` **in-app
   only** — it does not OS-fire — unless the user instead chooses **remove** or opens the
   note via the default click.

This is symmetric with the missed/grace discovery rules: an *expired relative* snooze, or
a snooze-0 chosen after `dueAt`, is treated as discovery of an overdue reminder (in-app
only, no stale popup), never as a fresh fire — while snooze-0 **at** `dueAt` is a genuine
scheduled fire and pops once.

---

## Phases

Each phase is independently shippable and testable. Rust phases reuse the workspace;
TS phases reuse existing pane/editor infra. Tests are mandatory per phase
(Vitest for TS, `cargo test` for Rust) — failing tests block the phase.

### Phase 0 — Spec + ADR + cargo layout decision  ✅ DONE (2026-06-06 — [ADR 003](../adrs/003-adr-reminder-daemon.md))

**Outcome:** All Phase 0 deliverables are locked in [ADR 003](../adrs/003-adr-reminder-daemon.md):
the separate-daemon decision, **cargo layout** (a cargo **workspace** with a pure
`crates/eskerra-reminder-core` consumed by both the app and a slim `crates/eskerra-reminderd`
daemon that excludes the Tauri/GUI stack — chosen over a `lib + two bins` split so the
daemon stays lean), the finalized **index + `reminderd.json` schema**, the
**`dev.eskerra.Reminders1` IPC interface**, the **systemd unit + RPM packaging sketch**,
the **observability fields list**, and the **locked `RemoveReminder` failure contract**
(`removed` / `stale` / app-side `remove-unavailable`). No runtime code was written.

**Scope:** This document + an ADR for "separate reminder daemon" (under `specs/adrs/`)
+ decide cargo layout: split `src-tauri` into a `lib` + two `bin` targets (`app`,
`reminderd`) sharing a reminder-core module, **or** a new workspace crate
`crates/eskerra-reminder-core`. Recommendation: a shared **library module/crate** for
token grammar + scanning + index schema, consumed by both the app and the daemon, so
the grammar is ported exactly once on the Rust side.

**Deliverables:** ADR, finalized index/IPC schema, systemd unit + autostart packaging
sketch, observability fields list, and the **locked IPC failure contract** (below). No
runtime code.

**Locked decision — `RemoveReminder` failure contract (must be pinned before Phase 0
closes):** Define the full result space of the removal IPC and pin it in the ADR:
(a) success → `removed`; (b) daemon received but refused to write safely → `stale`;
(c) **daemon unreachable** (not running / service not registered / timeout / any
transport-level bus error) → app-side `remove-unavailable`, **never** local strikethrough
and **never** recorded as daemon `stale`. The app keeps the row visible with retry +
open-note recovery and may best-effort (re)start the systemd `--user` daemon off the UI
thread. Full rules in the Phase 4 *IPC-unavailable contract*; this phase exists to lock
that behavioral contract before any code is written.

**Risks:** getting the index/IPC schema wrong forces churn later — pin it here. The
single highest-risk omission to resolve here is the daemon-unavailable transport-error
path (above): an unhandled transport error is exactly the kind of gap that tempts a
local-write fallback and silently breaks the single-writer invariant.

**LLM advice:** **Claude Opus 4.8, thinking high.** Pure architecture/trade-off work
across an unfamiliar multi-process boundary with hard correctness invariants; this is
the highest-leverage reasoning phase and benefits most from the strongest model.

### Phase 1 — Shared Rust reminder core (pure, no I/O side effects)

**Scope:**
- Port the `dateToken.ts` grammar to Rust (parse/validate, leap-year aware), with a
  test vector shared conceptually with the TS tests (same valid/invalid cases incl.
  `@2026-02-29`, `@…_2560`, and the struck-through `@~~…~~` → no match case).
- Scanner: given file bytes + vault-relative path, return for every token its
  **byte span** `tokenByteFrom`/`tokenByteTo` (UTF-8 byte indexes into the file) +
  parsed datetime, ignoring struck-through tokens. Byte spans are mandatory because
  Phase 4 verifies and replaces a byte slice; the scanner must **not** return character
  offsets for write use. Because the token grammar is ASCII and is matched inside valid
  UTF-8 markdown, `tokenByteFrom`/`tokenByteTo` always land on valid UTF-8 boundaries.
  Any editor-facing position (`uiCaretHint`) is derived separately and clearly marked
  advisory; it is never used for slicing.
- Index model + (de)serialization (serde), stable `id` derivation per the
  **Reminder identity** rules (path + normalized token text + occurrence ordinal;
  never offsets), atomic write helper, and **duplicate-aware merge / state migration**
  per the *Index merge / state migration* rules — exact-`id` carry for the common case,
  but for duplicate identical tokens migrate state only by `contextAnchor` (ordinal only
  when `scanFingerprint` proves the file unchanged) and fail safe to fresh reminders
  when the mapping is ambiguous; never carry state by ordinal-derived `id` alone.
- Date-only → `dueAt` resolution using the configurable default time.

**Deliverables:** `eskerra-reminder-core` with thorough `cargo test`, including:
identity stability when text above a token is inserted/deleted; correct ordinal
disambiguation of duplicate identical tokens; new-`id`-on-token-edit; struck-through
`@~~…~~` excluded from scan; and a **non-ASCII-before-token** test — a note containing
multi-byte UTF-8 (e.g. emoji / accented text) on lines above and on the same line
before the token, asserting that slicing `[tokenByteFrom, tokenByteTo)` yields exactly
the token bytes (no panic on a non-boundary slice, no off-by-bytes), that the byte span
diverges from the character offset as expected, and that the `uiCaretHint` conversion
is computed separately from the byte span; and **duplicate-aware merge** tests:
(a) exact-`id` carry preserves `state`/snooze for the non-duplicate / edit-elsewhere
case; (b) a snooze on one of several identical tokens migrates to the correct new `id`
by **unique `contextAnchor`** after an identical token is inserted above it (ordinal
drifted); (b') **exact-`id` carry is gated for duplicates** — the old ordinal-0
duplicate has a snooze, an identical token is inserted **above** it, and the old
ordinal-0 `id` **still exists** in the fresh scan but now points to the **newly inserted
line**; assert the blind exact-`id` carry does **not** fire for this duplicate content
key, that the snooze migrates only by **unique `contextAnchor`** to the original line's
new `id` (or is dropped if the anchor is ambiguous), and that **no**
snooze/`notified`/`stale` lands on the newly inserted line; (c) when surrounding context
is also identical and
`duplicateCount`/`scanFingerprint` changed, state is **not** migrated to any line —
candidates become fresh reminders rather than carrying snooze/`notified`/`stale` onto
the wrong occurrence; (d) ordinal-based migration is used only when the recomputed
content hash equals the stored `scanFingerprint`; (e) **`len`+`mtime` is not proof** —
a same-length edit above one of identical-context duplicates that preserves (or
artificially restores) `len`+`mtime` while changing the content hash must **not** be
treated as "unchanged": the ordinal is distrusted and the case fails safe (no wrong-line
migration), proving the content hash — not `len`+`mtime` — gates ordinal trust. No
watcher, no D-Bus, no real filesystem watching yet (scanning provided bytes is fine).

**Risks:** identity must be offset-independent (see Reminder identity); the only
residual ambiguity is multiple byte-identical tokens in one file, disambiguated by the
stored `contextAnchor` (with `scanFingerprint` gating any ordinal use) on **both**
critical paths — at merge time (state migration, *Index merge / state migration*) and
at write time (Phase 4's lookup-by-`id` then resolve-by-text-and-anchor,
unique-match-or-fail). Neither path may carry/select by ordinal-derived `id` alone;
ambiguity fails safe (merge → fresh reminders; write → `stale`).

**LLM advice:** **Claude Sonnet 4.6, thinking medium** for the bulk port (mechanical,
well-specified by `dateToken.ts`), escalate to **Opus 4.8 thinking medium** for the
`id`/merge design (the one subtle part). **Composer 2.5** is acceptable here *if you
want speed on the mechanical port* — it is pure, fully test-guarded Rust with an exact
TS reference, so a cheaper fast model is low-risk; keep Opus for the merge logic.

### Phase 2 — Daemon skeleton: watcher + index production + packaging

**Scope:**
- New binary `eskerra-reminderd`. Reads `~/.config/eskerra/reminderd.json` for vault
  root + settings; watches that config file for **both** live vault switches **and
  settings-only changes** (e.g. the date-only default time), applying the
  *Settings-only config change* re-derive path for the latter without a session bump.
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
vault switch, **settings-only change**, invalid config, restart-before-app-ran) with
their fail-safe behavior, and use atomic temp+rename for both the index and any
app-written config. The **settings-only change** test must assert that changing the
date-only default time re-derives `dueAtMs`/`fireAtMs` for date-only tokens **without**
a session bump or index teardown, **keeps the same reminder `id`s**, leaves explicit
timed `@…_HHMM` tokens untouched, and re-arms the scheduler from the new times.

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
  A scheduled-fire timer event **executes** a fire (per *scheduled-fire execution*),
  separately from discovery-context classification — see *Missed / grace semantics*.
- `zbus` client for `org.freedesktop.Notifications`: fire at T-5min with body =
  note title + reminder text context; actions: `snooze-3`, `snooze-1`, `snooze-0`,
  `remove`, plus default action (click). Localized/clear button labels
  ("Remind at T-3 min", …).
- Action handling per *Snooze action handling (including expired snooze)*. snooze-N
  computes `targetFireAt = dueAt − N min`. For **snooze-3 / snooze-1**: if
  `targetFireAt > now` reschedule `fireAt = targetFireAt` and persist the override; if
  `targetFireAt ≤ now` the relative snooze is **expired** — a scheduling no-op (no
  re-fire, no loop, no backwards move, only the OS notification closes). For **snooze-0**
  the equality boundary is **not** a no-op: `now < dueAt` persists `fireAt = dueAt` and
  schedules the at-time fire; `now == dueAt` **fires once immediately** via the
  exact-at-time scheduled-fire path (guarded by `lastNotifiedMs` / per-`fireAt` id);
  `now > dueAt` is expired (no stale popup). `remove` triggers Phase 4 write + closes;
  default click triggers Phase 5 open.
- **snooze-0 (`fireAt = dueAt`) must fire at-time.** Because the override is an
  intentional scheduled fire, the scheduler fires it once at `dueAt` (exact-at-time
  case) with the small `schedulerGraceMs` late tolerance; it is **not** swallowed by
  the overdue/stale-discovery suppression. Every fire is guarded against duplicates by
  `lastNotifiedMs` (or a per-`fireAt` fire-event id) so re-arm / reconcile / resume
  cannot double-fire the same `fireAt`.
- Missed/grace semantics from the architecture section — keep the **three** contexts
  distinct in the implementation: scheduled-fire execution, resume catch-up (deferred
  scheduled fire on wake), and stale discovery (classification only).
- **Linux suspend/resume handling (mandatory).** A `Duration`-based sleep-until-next
  timer does not advance across system suspend, and the wall clock can jump on resume,
  so a fire scheduled before suspend can be silently late or skipped. Subscribe to the
  `PrepareForSleep(bool)` signal on `org.freedesktop.login1` (D-Bus, via `zbus` — same
  client stack as notifications). On the `false` (waking) edge, **immediately**: (a)
  recompute "now" from the wall clock, (b) re-evaluate every reminder's
  missed/grace/overdue state using the *resume catch-up* rule (an already-scheduled
  reminder whose `fireAt`/at-time elapsed during suspend fires once on resume if still
  within `now ≤ dueAt + schedulerGraceMs` and it has not already fired for that `fireAt`;
  beyond that window it is marked `due`/overdue with no stale popup) — resume catch-up is
  a deferred scheduled fire, **not** stale discovery, so a brief suspend never downgrades
  an armed reminder to an in-app-only overdue row; reminders *first discovered* on the
  wake-edge scan still follow stale discovery. Honor `lastNotifiedMs` so resume never
  double-fires, and (c) fully re-arm the
  scheduler from the recomputed times rather than resuming the pre-suspend timer. Also re-evaluate on
  the same path for wall-clock jumps/timezone changes where detectable. If
  `login1`/`PrepareForSleep` is unavailable, fall back to a periodic wall-clock
  reconciliation tick (bounded interval) so a missed wake still self-heals.
- New deps justification (`zbus`): needed for action buttons + callbacks on GNOME;
  not on app startup path; cannot be deferred (core of requirement 6); Rust required
  (D-Bus, long-lived); risk = D-Bus availability → fall back to click-only
  notification and log; measured via notification-send success/fail counters.

**Deliverables:** real GNOME notifications with working snooze/remove/click on the
reference Fedora/GNOME environment. Tests (scheduler/action level, no live GNOME
required):
- **future snooze schedules:** snooze-3/snooze-1 chosen while `now < targetFireAt`
  persists `fireAt = dueAt − N min` and arms exactly one future fire.
- **expired snooze-3 is a no-op:** clicking snooze-3 when `now ≥ dueAt − 3min`
  (`targetFireAt ≤ now`) fires **no** OS notification, does not loop, does not move
  `fireAt` backwards, and leaves the reminder's `state` unchanged (only the notification
  closes).
- **expired snooze-1 is a no-op:** same assertion for snooze-1 when `now ≥ dueAt − 1min`.
- **snooze-0 before due schedules at-time:** snooze-0 with `now < dueAt` persists
  `fireAt = dueAt` and fires once exactly at `dueAt` via the exact-at-time scheduled-fire
  path.
- **snooze-0 at exactly `dueAt` fires once (NOT a no-op):** snooze-0 chosen when
  `now == dueAt` fires the OS notification **immediately, once** through the exact-at-time
  scheduled-fire path, records `lastNotifiedMs`, and is **not** closed-without-firing as
  an expired action. A second snooze-0 at the same instant does not double-fire.
- **snooze-0 after due is expired:** snooze-0 chosen when `now > dueAt` is an expired
  no-op (no stale popup), `due` in-app only.
- **no immediate-notification loop:** repeatedly choosing an *expired* snooze (relative
  snooze-3/-1 past target, or snooze-0 past `dueAt`) never produces a second/duplicate
  immediate notification (guarded by the expired-no-op rule and `lastNotifiedMs`).

**Risks:** D-Bus action callbacks require the sender to stay alive (the daemon does);
notification daemon quirks across GNOME versions; clock changes / suspend-resume
(handled via `org.freedesktop.login1` `PrepareForSleep` + on-resume re-evaluation
above, with a periodic wall-clock reconciliation fallback).

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

0. **Serialize all writes to a note (per-note write lock).** The daemon serializes
   **all** vault-markdown writes per `noteUri` / vault-relative path using a keyed
   per-note mutex (or a per-note write queue) — atomic temp+rename alone is *not*
   sufficient: it prevents partial files, but two concurrent `RemoveReminder` calls for
   **different** tokens in the **same** note can each read the same old bytes, each apply
   one strikethrough, and the later rename then clobbers the earlier strikethrough — a
   lost logical update. To prevent this, a `RemoveReminder` write-back **must acquire the
   target note's write lock before re-reading/re-scanning the file**, and hold it
   continuously through re-read, re-scan, span resolution (rules 1–2), byte verification
   (rule 4), temp write, atomic rename (rules 5–6), **and** the index update / single-note
   rescan that records the outcome for that note. Only then is the lock released.
   - **Different notes run in parallel.** The lock is keyed per `noteUri`, so removes
     targeting different notes never block each other.
   - **Same note runs sequentially.** Concurrent removes for the same note are processed
     one at a time. The second remove acquires the lock only after the first fully
     completes, so its re-read/re-scan observes the first remove's on-disk strikethrough.
     It then resolves normally against that fresh content (rules 1–3): if its token is now
     gone (already struck/edited/deleted) → `removed` (no write); if its token is still
     present → strike it safely; if resolution is ambiguous → `stale`. No second remove
     ever reads pre-first-write bytes, so no strikethrough is lost.
   - Key the lock by the canonical vault-relative path (not a raw `noteUri` string) so
     path aliases/encodings for the same file share one lock. Use the same lock for any
     future daemon-owned write to that note, keeping the single-writer invariant
     race-free as well as exclusive.
1. **Look up the stored reminder entry by `id` first.** `RemoveReminder(noteUri, id)`
   resolves the request against the **index**, not against freshly scanned tokens: load
   the stored entry whose `id` equals the requested `id` and read its
   `normalizedTokenText`, `contextAnchor`, `duplicateCount`, `occurrenceOrdinal`, and
   `scanFingerprint`. If no such entry exists in the index → treat as already gone
   (`removed`, rule 3). **Never recompute `id` from current ordinals as the primary
   match filter** — `id` embeds `occurrenceOrdinal`, and ordinal drift is precisely the
   duplicate-token failure mode, so an `id`-equality filter over freshly scanned tokens
   would silently select the wrong occurrence.
2. **Re-read + re-scan, then resolve the live token by token text + anchor.** Read the
   current file bytes from disk and re-scan. Resolution proceeds from the stored entry's
   fields, not from recomputed ids:
   - **Collect live candidates by `normalizedTokenText`** in the target note (every
     live token whose normalized text equals the stored entry's `normalizedTokenText`).
   - **Prefer a unique `contextAnchor` match** among those candidates: if exactly one
     candidate's containing-line anchor equals the stored `contextAnchor`, its freshly
     scanned **byte span** `[tokenByteFrom, tokenByteTo)` is the target span. The write
     path operates exclusively on this byte span — never on character offsets or any
     `uiCaretHint`.
   - **Use `occurrenceOrdinal` only as a tie-breaker, and only when the recomputed
     content hash equals the stored `scanFingerprint`** (the file is byte-for-byte
     unchanged since the entry was scanned). A matching `len`+`mtime` does **not**
     qualify — it is only an optional pre-check before hashing. If the file is
     byte-unchanged, the stored ordinal still indexes the same occurrence and may break a
     tie; if the content hash differs at all, the ordinal is not trusted.
   - **Fail closed (`stale`) on ambiguity:** if candidates/anchors/fingerprint cannot
     single out exactly one occurrence — e.g. duplicate tokens share an identical
     `contextAnchor` and `scanFingerprint` no longer matches (so the ordinal cannot be
     trusted), or `duplicateCount` differs from the live count in a way that leaves the
     target ambiguous — do **not** guess.
3. **Distinguish zero-match (removed) from unsafe (stale).** Outcomes:
   - **No live candidate matches** the stored `normalizedTokenText` (token already
     struck through, its date/time was edited, or it was deleted), or no index entry
     exists for the `id` → this is a *success-equivalent*: the reminder is already gone.
     Perform **no** write, resolve it as **`removed`**, and drop it from the index. This
     is not an error.
   - **Ambiguous resolution** (multiple candidates not separable per rule 2),
     **byte mismatch** (rule 4 fails), **IO/read/write error**, or any other situation
     where the daemon cannot identify *exactly one* correct span with confidence →
     mark **`stale`**, write nothing.
4. **Verify the bytes at the resolved byte span are exactly the expected token.**
   Before editing, assert the byte slice `[tokenByteFrom, tokenByteTo)` of the
   on-disk file equals the normalized token text (ASCII bytes). This slice uses the
   **byte span only** — never a character offset (in UTF-8, character offsets diverge
   from byte indexes whenever non-ASCII text precedes the token, which would slice the
   wrong bytes or panic on a non-boundary). If the slice does not equal the expected
   token (drift/corruption/encoding surprise) → no write → `stale` (rule 3).
5. **Byte-preserving, minimal edit.** Replace only the byte slice
   `[tokenByteFrom, tokenByteTo)` with the struck form, leaving every other byte —
   including all preceding/following multi-byte UTF-8, line endings, trailing
   whitespace, BOM, and final-newline state — untouched. No reformatting, no
   re-serialization of the document.
6. **Atomic write.** Write to a temp file in the same directory and `rename` over the
   original, so a reader never sees a partial file and the app's watcher sees one clean
   external edit. The atomic rename happens **while the per-note write lock (rule 0) is
   held**, so a concurrent same-note remove cannot have read the pre-rename bytes — atomic
   rename guards against partial files; the lock guards against lost logical updates.
7. **Fail closed → surface, don't guess.** For every `stale` outcome from rule 3, the
   daemon performs **no** write and surfaces `stale` in the index. The app shows the row
   as "could not remove — open the note" (links to the note for manual edit) instead of
   silently dropping it or striking the wrong span. `stale` reminders stop firing OS
   notifications but remain visible until resolved. (Contrast: `removed` from a
   zero-match silently and correctly disappears.)
8. **No writes to a note with an unsaved in-editor draft are special-cased in the
   daemon** — the daemon only ever rewrites the on-disk file via the atomic path above.
   Reconciliation with an open editor is the app's existing job: the resulting
   `vault-files-changed` event flows through the established conflict/reconcile
   machinery (AGENTS.md *Vault disk sync invariants* + *Note body cache*), which must
   not clobber the user's draft.

**IPC-unavailable contract (daemon not reachable — distinct from `stale`):**

`RemoveReminder` is a D-Bus method call that can fail at the **transport** level —
before the daemon ever evaluates the request — when the daemon is not running, the
`dev.eskerra.Reminders1` service is not registered, the call times out, or the bus
returns any other transport error. This is categorically different from a `stale`
result and must be handled by the **app**, not the daemon:

1. **The single-writer invariant still holds — no local fallback write, ever.** The app
   must **never** strike the token itself when the daemon is unreachable. There is no
   "write locally if IPC fails" path; that would reintroduce a second writer and defeat
   the entire model.
2. **Classify by origin, not just failure.** A transport-level failure (unreachable /
   missing service / timeout / bus error) is surfaced as a **UI-level remove failure**
   — call it `remove-unavailable` — on the app side only. It is **not** written into the
   index as daemon `stale`. `stale` is reserved for "daemon received the request and
   refused to write safely"; `remove-unavailable` means "the daemon could not be
   reached at all". The index is owned by the daemon, so an unreachable daemon by
   definition cannot have produced a `stale` entry for this attempt.
3. **Keep the row, offer recovery.** The reminder row stays visible and active
   (unchanged on disk, still firing per its schedule). The pane row shows a
   `remove-unavailable` affordance with a **Retry** action (re-issues `RemoveReminder`)
   and an **Open note** fallback for manual resolution. Nothing is silently dropped.
4. **Best-effort daemon (re)start, never blocking the UI.** On a transport failure the
   app *may* attempt to start/restart the daemon via its systemd `--user` service
   (e.g. `systemctl --user start eskerra-reminderd`) if that is available, then retry
   `RemoveReminder` after a short delay. This is strictly best-effort: it runs
   off the UI thread, must not block or freeze the pane, and on continued failure the
   row simply remains in `remove-unavailable` for the user to retry later.
5. **Recovery is seamless.** Once the daemon is reachable again (manual retry, the
   best-effort restart, or a later user action), a successful `RemoveReminder` proceeds
   through the normal write-back rules and the row resolves (`removed`, or `stale` if
   the daemon now refuses for a safety reason). No app restart required.

**Deliverables:** removing a reminder (from OS notification or app pane) either reliably
strikes the exact token on disk (surviving concurrent edits elsewhere in the file),
fails closed into a visible daemon `stale` state (received but unsafe), or — when the
daemon cannot be reached — leaves the row visible in a UI-level `remove-unavailable`
state with retry/open-note recovery; in no case does the app perform a local write or
strike a wrong/partial span.

**Phase 4 tests (write-path level, mandatory):** beyond the resolution/fail-closed cases
exercised end-to-end in Phase 7, this phase must include a **concurrent same-note
no-lost-update** test: issue two `RemoveReminder` calls **concurrently** for two
**different** tokens in the **same** note and assert both strikethroughs survive — the
final on-disk file contains **both** struck tokens, neither remove clobbers the other,
both resolve `removed`, and the index reflects both. Also assert that two removes for
**different** notes can run **in parallel** (the per-note lock does not serialize across
notes).

**Risks (highest data-loss surface in the whole plan):** clobbering concurrent edits;
**lost logical updates when two removes target the same note** (each reads the same old
bytes and the later rename overwrites the earlier strikethrough — atomic rename alone
does not prevent this); striking the wrong span after ordinal/offset drift among
duplicate identical tokens; slicing the wrong bytes when character offsets are used on
non-ASCII text; encoding/line-ending changes. Mitigation: **per-note write
serialization (write-back rule 0)** held across re-read → re-scan → resolve → verify →
temp write → atomic rename → index update; re-scan at write time, resolve by index
lookup + `contextAnchor` (ordinal only authoritative when `scanFingerprint` matches),
operate strictly on the token **byte span** `[tokenByteFrom, tokenByteTo)` (never
character offsets), zero-match → `removed` vs. any ambiguity/mismatch/IO → `stale`,
byte-preserving atomic edit; mandatory tests.

**LLM advice:** **Claude Opus 4.8, thinking high — non-negotiable here.** This is the
markdown-integrity / data-loss surface the repo guards most heavily
(`review-markdown-integrity-data-loss-prevention` skill exists for exactly this). Do
**not** use a cheaper model for the write path. After implementation, run the
markdown-integrity review skill over the diff.

### Phase 5 — Click-to-open: launch/focus app, navigate to note + caret

**Scope:**
- Add `tauri-plugin-single-instance` (or equivalent) to the app. Default-action click
  in the daemon spawns `eskerra --open-reminder <noteUri> <reminderId>`, with an
  **optional** `--ui-caret-hint <pos>`; if the app is already running, single-instance
  forwards argv to the live instance.
- **Never trust a stale position as the source of truth, and never use a byte span as a
  CodeMirror position.** The open command carries `reminderId` (authoritative) plus an
  optional `uiCaretHint` (an advisory UI position from the index's last scan, used only
  as a scroll starting guess — never the daemon's byte span). A daemon/index **byte
  span** (`tokenByteFrom`/`tokenByteTo`) is a UTF-8 file offset, not a CodeMirror
  position, and must **never** be fed directly to the editor; the app derives the editor
  position itself. On open, the app:
  1. opens the note and resolves the live token by the **same lookup-then-resolve rule
     as the writer** (Phase 4): look up the stored index entry by `reminderId`, then
     collect live candidates by its `normalizedTokenText`, prefer a unique
     `contextAnchor` match, and use `occurrenceOrdinal` only as a tie-break when
     `scanFingerprint` proves the file unchanged — **never** by recomputing `id` from
     current ordinals (so it survives edits since the last scan);
  2. on a unique match, computes the editor caret position from the resolved token in
     the editor's own document model (converting from the token's location to the
     CodeMirror position the editor expects — not reusing a raw byte span) and places
     the caret **immediately after that token** (reuse `dateTokenAtPosition` to find the
     token end, consistent with the existing date-token click routing in
     `dateTokenClick.ts` / `noteMarkdownPointerLinks.ts`) and scrolls it into view;
  3. **Fallbacks when the token cannot be found safely** (zero match — already struck,
     edited, or removed; or ambiguous match): do **not** jump to a guessed/stale
     position. Open the note at top (or, if `uiCaretHint` is present and still inside the
     document bounds, scroll near it without asserting a caret-after-token), and do not
     fail the open. A `removed`/missing token simply opens the note; never throw or
     place the caret at a position that no longer corresponds to a token.
- Cold-start path: if the app was not running, it boots, then applies the pending open
  command after vault hydration (respect the first-render-sacred invariant: queue the
  navigation, don't block startup). Token resolution (above) runs after hydration when
  the note text is actually loaded, so the rescan always sees real current content.

**Deliverables:** clicking the OS notification opens the right note and, when the token
still exists, places the caret right after it; when it does not, opens the note
gracefully without a stale/guessed caret jump — whether or not the app was already
running.

**Risks:** focus-stealing/raise behavior on GNOME/Wayland; race between boot hydration
and the queued open command (reuse the existing deferred-restore pattern in
`useInboxShellRestore`); never resolving caret from `uiCaretHint` alone — it is only a
scroll hint, the rescan is authoritative; never feeding a daemon/index byte span to
CodeMirror as a position.

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
- **Daemon-unavailable rendering (`remove-unavailable`):** the IPC call can fail at the
  transport level when the daemon is down (Phase 4 *IPC-unavailable contract*). On such
  a failure the app keeps the reminder row visible and renders an inline
  `remove-unavailable` state — distinct in copy from daemon `stale` (e.g. "Couldn't
  reach the reminder service" vs. `stale`'s "Couldn't remove safely — open the note").
  The row exposes a **Retry** affordance (re-issues `RemoveReminder`) and an **Open
  note** fallback. The optional best-effort daemon (re)start runs off the UI thread and
  must not block the pane; while it is in flight the row may show a transient
  "retrying…" hint but stays interactive. `remove-unavailable` is **app-local UI state
  only** — it is never written to the daemon-owned index, and it clears automatically
  once a retry succeeds. The single-writer invariant is preserved: no local strikethrough
  is ever attempted on this path.
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
repo has a dedicated `review-state-consistency` skill). Three failure renderings must
stay distinct: daemon `stale` (received-but-unsafe; index-backed; link to note),
app-local `remove-unavailable` (daemon unreachable; retry + open-note; never index-backed
and never a local write), and normal `removed` (disappears). Conflating
`remove-unavailable` with `stale` would mislead the user about whether the daemon ever
saw the request.

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
- Index merge / state-migration integration tests (end-to-end across a live rescan):
  - **Unique-anchor migration:** with several byte-identical tokens in a note, snooze
    (and let it record `lastNotifiedMs` / `notified`) one of them, then on disk insert
    another identical token **above** it so `occurrenceOrdinal`s shift and the affected
    `id`s change. Because `contextAnchor` uniquely identifies the old reminder, assert
    its `state` / snooze (`fireAtMs`) / `lastNotifiedMs` migrate to the **new `id`** on
    the same line.
  - **Exact-`id` carry gated for duplicates (old ordinal-0 id survives):** the old
    ordinal-0 duplicate has a snooze; insert a **new identical token above it** so the
    old ordinal-0 `id` **still exists** in the fresh scan but now points to the **newly
    inserted line**. Assert the blind exact-`id` carry does **not** run for this
    duplicate content key; the snooze migrates only by **unique `contextAnchor`** to the
    original line's new `id` (or is dropped if ambiguous); and **no**
    snooze/`notified`/`stale` state lands on the newly inserted line.
  - **Identical-context → no migration:** with duplicates that also share identical
    surrounding context (so `contextAnchor` cannot separate them) and a changed
    `duplicateCount` / `scanFingerprint` after the edit, assert **no** `state` / snooze /
    `notified` / `stale` is migrated to any candidate; the live reminders are recomputed
    **fresh** (default state, scheduled per discovery rules) and no spurious OS fire
    results from the re-derivation.
  - **`len`+`mtime` is not proof (same-length / preserved-mtime edit):** simulate an
    external editor / Syncthing update that makes a **same-length** edit above one of
    identical-context duplicates while preserving (or artificially restoring) the file's
    `mtime`, so `len`+`mtime` look unchanged but the content hash differs. Assert the
    daemon recomputes the content hash, finds it ≠ stored `scanFingerprint`, distrusts
    the ordinal, and fails safe (no migration of snooze/`notified`/`stale` to any line).
    A matching `len`+`mtime` alone must never be accepted as "unchanged".
  - **No wrong-line carry (all cases):** explicitly assert that no snooze / `stale` /
    `notified` state is ever attached to a different line than the one it originated on —
    state either lands on the correct migrated `id` or is dropped, never on a sibling
    duplicate.
- Write-back fail-closed tests: token already struck/edited/gone before remove
  (zero-match → `removed`, no write); byte mismatch at resolved byte span (no write,
  `stale`); ambiguous duplicate match (no write, `stale`); **non-ASCII-before-token
  write** — strike a token in a note with multi-byte UTF-8 before it, asserting the
  edit replaces exactly `[tokenByteFrom, tokenByteTo)` and leaves all surrounding bytes
  intact (proving byte spans, not character offsets, drive the write);
  **duplicate-identical-token ordinal drift** — insert/delete an identical token above
  the target between scan and remove so the ordinal shifts, assert resolution by
  `contextAnchor` and, when context is also identical with a changed
  `duplicateCount`/`scanFingerprint`, fail-closed to
  `stale` rather than striking the wrong occurrence; **same-length / preserved-mtime
  edit** — make a same-length edit above an identical-context duplicate while keeping
  `len`+`mtime` unchanged so the content hash diverges, and assert the writer recomputes
  the content hash, refuses to trust the ordinal, and fails closed to `stale` rather
  than striking by stale ordinal. Assert no wrong-span and no partial writes in every
  case.
- Concurrent-write serialization tests (per-note write lock, *Write-back safety rules*
  rule 0):
  - **Same-note, two tokens, no lost update:** a note with two distinct, non-struck
    tokens; issue `RemoveReminder` for **both concurrently**. Assert the final on-disk
    file contains **both** strikethroughs (neither remove clobbers the other), both
    resolve `removed`, the index drops both, and every other byte of the note is
    unchanged. Without the lock this is the lost-update failure (the later atomic rename
    overwrites the earlier strikethrough); the test must fail if serialization is removed.
  - **Same-note sequential observation:** the second of two same-note removes observes the
    first remove's on-disk strikethrough during its re-read/re-scan — if its own token is
    now gone it resolves `removed`, if still present it strikes safely, if ambiguous it is
    `stale`; never reads pre-first-write bytes.
  - **Different notes run in parallel:** concurrent removes targeting **different** notes
    are not serialized by the per-note lock (assert they can interleave / both complete
    without one blocking on the other's lock).
- Scheduler-semantics tests (scheduled fire vs. stale discovery):
  - **snooze-0 fires at-time:** a reminder scheduled before `dueAt` then snoozed to
    `fireAt = dueAt` fires the OS notification once at `now == dueAt` (exact-at-time
    case), is **not** suppressed as overdue, and records `lastNotifiedMs`.
  - **scheduler-late tolerance:** a scheduled fire whose event arrives slightly late
    (`dueAt < now ≤ dueAt + schedulerGraceMs`) still fires once; past the grace window
    it does not OS-fire and is downgraded to in-app discovery.
  - **stale discovery after `dueAt` does not fire:** a reminder first discovered after
    `dueAt` (daemon restart / fresh scan / vault switch with no prior scheduled fire)
    is marked `due`/overdue in-app with **no** OS popup.
  - **no duplicate / late double-fire:** re-arm, minute-tick reconcile, and resume
    re-evaluation do not re-fire a reminder already fired for the same `fireAt`
    (guarded by `lastNotifiedMs` / per-`fireAt` fire-event id).
  - **expired snooze is a no-op (no late OS popup, no loop):** clicking snooze-3 when
    `now ≥ dueAt − 3min` and clicking snooze-1 when `now ≥ dueAt − 1min` (the OS
    notification lingered past T-3 / T-1) each fire **no** OS notification, do not move
    `fireAt` backwards, leave `state` unchanged, and produce no duplicate/immediate
    notification loop on repeated clicks; the reminder stays in-app only.
  - **snooze-0 boundary cases (equality fires, not no-op):** snooze-0 chosen with
    `now < dueAt` persists `fireAt = dueAt` and fires once at `dueAt`; snooze-0 chosen at
    exactly `now == dueAt` fires the OS notification **once immediately** through the
    exact-at-time scheduled-fire path (records `lastNotifiedMs`) and is **not** treated as
    an expired no-op; snooze-0 chosen after `dueAt` is an expired no-op with no stale
    popup. Assert the equality case fires exactly once (a repeated snooze-0 at the same
    instant does not double-fire).
- Suspend/resume tests (**resume catch-up**, distinct from stale discovery): an
  **already-scheduled** reminder whose at-time/`fireAt` elapses during a simulated suspend
  fires once on the `PrepareForSleep(false)` resume edge when still within
  `now ≤ dueAt + schedulerGraceMs` and not already fired (covers snooze-0 across a short
  suspend) — assert a brief suspend does **not** silently downgrade it to an in-app-only
  overdue row; one elapsed beyond that window becomes overdue/`due` with no stale popup; a
  reminder **first discovered** on the wake-edge scan (not scheduled before suspend) still
  follows stale discovery (in-app only, no popup); full re-arm from recomputed wall-clock
  times; fallback reconciliation tick when `login1` is unavailable.
- Daemon-unavailable IPC tests: with the daemon down / service unregistered / call
  timing out, `RemoveReminder` returns a transport error → the app performs **no local
  write**, keeps the reminder row visible in `remove-unavailable` (distinct from
  `stale`), and renders Retry + Open-note. Assert the on-disk note is byte-unchanged.
  Then bring the daemon back and assert a retried `RemoveReminder` succeeds end-to-end
  (token struck on disk, row resolves to `removed`). Assert the best-effort restart
  attempt does not block the UI and that `remove-unavailable` is never written into the
  index.
- Click-to-open tests: token present → caret immediately after token; token
  struck/edited/removed → note opens gracefully with no stale/guessed caret jump;
  `uiCaretHint` used only as a scroll hint, never as caret source of truth; a daemon
  byte span is never used directly as a CodeMirror position (including a non-ASCII note
  where the byte span and the editor position diverge); cold-start resolves the token
  after hydration against current content.
- Config/vault edge-case tests: no vault idle; missing vault path preserves index and
  does not fire; invalid `reminderd.json` keeps last-known-good; restart-before-app-ran
  rebuilds from disk; clear-all leaves reminder rows untouched.
- Settings-only config-change tests (date-only default time re-derive, end-to-end):
  - **Re-derive on settings-only update:** with a date-only token `@YYYY-MM-DD` indexed
    against a 09:00 default, rewrite `reminderd.json` with the **same** `vaultRoot`/
    `vaultHash` but a new default time (e.g. 08:00). Assert the daemon reloads config and
    re-derives without a vault switch (no session bump, no index teardown), the **same
    reminder `id`** now carries the **new** `dueAtMs`/`fireAtMs`, and the scheduler
    re-arms from the new `fireAt`.
  - **Old notified state does not suppress the new fire:** the date-only reminder was
    already `notified`/`lastNotifiedMs` at the old 09:00; after the default time changes
    to an earlier-but-still-future 08:00, assert the stale `notified`/`lastNotifiedMs` is
    reset/recomputed for the new time so the reminder fires again at the new time (and is
    not swallowed as already-notified). Conversely a guard against double-firing the
    **new** `fireAt` still holds.
  - **Timed tokens unaffected:** an explicit `@YYYY-MM-DD_HHMM` reminder in the same vault
    keeps its `dueAtMs`/`fireAtMs` and notification state unchanged across the default-time
    change (no re-derive, no spurious re-fire).
- Observability: scan duration, reminder counts, notification send success/fail,
  D-Bus unavailability, `RemoveReminder` transport-failure (`remove-unavailable`) rate
  and best-effort-restart outcomes, watcher coarse-invalidation (mirror the app's Sentry
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

- **Resolved (locked in Phase 0):** the `RemoveReminder` daemon-unavailable / transport-error
  contract — see the Phase 0 *Locked decision* and the Phase 4 *IPC-unavailable
  contract*. App-side `remove-unavailable` with retry + open-note, best-effort daemon
  restart, never a local write, never recorded as daemon `stale`.
- Exact systemd packaging story in the existing RPM build (enable on install?
  user-service template path).
- Whether the daemon should also own a tiny tray entry, or stay fully headless
  (current plan: fully headless; app launched on click is enough).
- Notification grouping/coalescing policy when many reminders fire close together.
- Settings surface for the date-only default time (09:00) — where it lives in app
  settings and how it reaches `reminderd.json`.
