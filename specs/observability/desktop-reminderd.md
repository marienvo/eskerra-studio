# Observability: `eskerra-reminderd` (reminder daemon)

This runbook defines the observability signals for the headless reminder daemon
(`crates/eskerra-reminderd`) and the one app-side counterpart, so daemon
degradation is visible within minutes — mirroring the desktop Sentry discipline
in [`desktop-vault-watch-coarse-alert.md`](desktop-vault-watch-coarse-alert.md).

## Why structured stderr, not Sentry (in the daemon)

The daemon is a deliberately slim, headless process that **excludes the
Tauri/Sentry dependency graph** (ADR 003 §2). It therefore cannot push to Sentry
directly the way the app does. Instead it writes **one structured line per
event** to **stderr**, captured by systemd journald
(`journalctl --user -u eskerra-reminderd`). A journald → Sentry/Loki shipper can
alert on these names. The line format is fixed (one event per line) so log
shippers can parse it reliably:

```
obs_event=<stable.name> key=value key=value …
```

Emission path: [`crates/eskerra-reminderd/src/obs.rs`](../../crates/eskerra-reminderd/src/obs.rs)
(`obs::emit` / `obs::format_event`). Tag values are sanitized (whitespace → `_`)
so a stray newline in an error string can never split a line.

**Non-PII rule:** vault identity is always the **hash** (`vault_hash`), never a
path. Reminder ids embed a vault-relative path, so they are **not** emitted.

## Daemon events

| `obs_event` | When | Tags |
|---|---|---|
| `eskerra.reminderd.scan_completed` | A full or incremental vault scan finished | `vault_hash`, `reminder_count`, `full` (`true`/`false`), `coarse` (`true`/`false`), `duration_ms` |
| `eskerra.reminderd.watch_coarse_invalidation` | A watch batch arrived **coarse** (precise backend dropped events → forced full rescan) | `vault_hash`, `path_count` |
| `eskerra.reminderd.notification_send` | One OS notification send attempt resolved | `result` (`ok`/`error`), `error` (on failure) |
| `eskerra.reminderd.dbus_unavailable` | A required D-Bus subsystem is unavailable (degraded fallback active) | `subsystem` (`notifications`/`login1`), `error` |
| `eskerra.reminderd.remove_result` | A `RemoveReminder` write-back resolved on the daemon side | `vault_hash`, `result` (`removed`/`stale`) |

### Signal interpretation

- **`scan_completed.duration_ms`** — the watcher latency budget is < 1s
  detection→index-update (plan §*Why a separate process* / Phase 2). A sustained
  rise in `duration_ms` (especially with `full=true`) on a large vault is the
  early warning. Pair with `reminder_count` for context.
- **`watch_coarse_invalidation`** — the daemon mirror of the app's
  `vault_watch_coarse_invalidation`. A steady stream means the precise
  filesystem backend is degraded and the daemon is repeatedly full-scanning;
  same triage as the app runbook (backend errors, ulimit/inotify exhaustion).
- **`notification_send result=error`** — GNOME/D-Bus notification delivery is
  failing. A burst usually accompanies `dbus_unavailable subsystem=notifications`.
- **`dbus_unavailable subsystem=login1`** — suspend/resume catch-up cannot use
  `PrepareForSleep`; the daemon falls back to the periodic reconciliation tick
  (a missed wake still self-heals, just less promptly).
- **`remove_result result=stale`** — the daemon received a remove but refused to
  write safely (ambiguous duplicate / byte mismatch / non-UTF-8 / IO error). A
  spike means notes are drifting under the daemon (e.g. heavy concurrent
  Syncthing edits); the reminder stays visible and the user is steered to open
  the note. This is **not** a data-loss event — no write happened.

## App-side counterpart

| `message` (Sentry) | When | Tags |
|---|---|---|
| `eskerra.desktop.reminder_remove_unavailable` | The app's `RemoveReminder` IPC failed at the transport level (daemon unreachable) → app-side `remove-unavailable` | `obs_surface=reminders`, `vault_root_hash` |

Emission path:
[`apps/desktop/src/hooks/useReminderPane.ts`](../../apps/desktop/src/hooks/useReminderPane.ts)
via `captureObservabilityMessage` (level `warning`).

This is the **distinct** failure mode from the daemon's `remove_result=stale`:
`stale` means the daemon *received* the request and refused safely;
`remove_unavailable` means the daemon never saw it. The app performs **no local
strikethrough** on this path (the single-writer invariant holds), keeps the row
visible with Retry + Open-note, and clears the state automatically once a retry
succeeds. The Sentry message intentionally omits the reminder id (it embeds a
path) — the `vault_root_hash` tag is the only vault identifier.

## Suggested alerts

- `notification_send result=error` rate > N/hour, or any sustained
  `dbus_unavailable subsystem=notifications` → notifications are broken.
- `watch_coarse_invalidation` rate climbing → watcher degradation (same as the
  app coarse-invalidation alert).
- `reminder_remove_unavailable` rate climbing → the daemon is down / not
  registered for a population of users (also watch for it correlating with the
  daemon process not running).
