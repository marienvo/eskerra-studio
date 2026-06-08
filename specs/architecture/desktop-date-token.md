# Desktop date tokens (`@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM`)

Desktop-only feature in the vault **capture** markdown editor (CodeMirror 6). Users can type or pick calendar dates (and optional 24-hour times) as plain-text tokens in notes. Tokens are **not** reminders yet — there is no reminder index, notification model, or Today Hub integration in this contract.

Module map: [`apps/desktop/src/editor/noteEditor/dateToken/`](../../apps/desktop/src/editor/noteEditor/dateToken/) (see [`ARCHITECTURE.md`](../../apps/desktop/src/editor/noteEditor/ARCHITECTURE.md)).

## Token grammar

```
DATE_TOKEN = "@" YYYY "-" MM "-" DD ( "_" HHMM )?
STRUCK_DATE_TOKEN = "@~~" YYYY "-" MM "-" DD ( "_" HHMM )? "~~"
```

- **With time:** `@2026-12-28_2352` (hour and minute as two-digit 24-hour fields, no colon).
- **Without time:** `@2026-12-28` (the `_HHMM` suffix is omitted).
- **Struck (completed reminder):** `@~~2026-06-08_0930~~` — written by `eskerra-reminderd` on removal or by the user via the picker **Completed** toggle. An optional backslash before `_` (`\_`) is accepted when parsing daemon output but user writes always emit canonical `_`.

Single source of truth for parsing, formatting, and scan regexes: [`dateToken.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateToken.ts).

| Export | Role |
|--------|------|
| `DATE_TOKEN_PATTERN` | Live-token scan (`(?:^|\s)(@…)`; group 1 is the token span). |
| `STRUCK_DATE_TOKEN_PATTERN` | Struck-token scan (`@~~…~~`; group 1 is the full span). |
| `DATE_TOKEN_PREFIX_PATTERN` | Word-boundary check when the user has just typed `@`. |
| `collectDateTokenSpansInLine(line)` | Non-overlapping live + struck spans on one line (struck first). |
| `parseDateToken(text)` | Parses a live `@…` span; returns `{year, month, day, hour?, minute?}` or `null`. |
| `parseDateTokenSpan(span)` | Parses live or struck full span; sets `struck: true` for `@~~…~~`. |
| `formatDateToken(value)` | Builds on-disk string; when `value.struck`, emits `@~~…~~` (canonical `_`, never `\_`). |
| `isValidCalendarDate` | Leap-year aware month/day validation. |

**Validation:** A span is styled and treated as a date token only when `parseDateToken` succeeds. Invalid dates (for example `@2026-02-29`) and invalid times (for example `@2026-01-01_2560`) stay **plain unstyled text** so partial typing does not flash false chips.

## Word-boundary trigger

The date/time picker opens on a newly typed `@` only when `@` is at a **word boundary**:

- Start of line, or
- Immediately after whitespace.

This avoids false triggers inside email-like text (`foo@bar.com`). The `@` character **remains in the document**; the picker is a non-modal overlay, not a CodeMirror autocomplete dropdown.

Implementation: [`dateTokenTrigger.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenTrigger.ts) (`EditorView.inputHandler` + `DATE_TOKEN_PREFIX_PATTERN`).

## Picker UI

Presentational React overlay: [`dateToken/dateTimePicker/`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTimePicker/) (public import via [`DateTimePicker.tsx`](../../apps/desktop/src/editor/noteEditor/dateToken/DateTimePicker.tsx) re-export).

- **Calendar:** month grid with previous/next month navigation; week rows start on **Monday** (Fedora/GNOME reference).
- **Today:** prominent button sets the selected date to the current local calendar day.
- **Time:** hour and minute inputs (24-hour) plus a **No time** toggle. When **No time** is on, time inputs disable and confirm yields a date-only token. Minute input uses a **5-minute step** (`step={5}`, max 55); typed or spinner values snap to the nearest 5-minute boundary.
- **Completed:** checkbox below time strikes a live reminder via the same `RemoveReminder` IPC as the Notifications pane (lookup by `noteUri` + normalized token text + occurrence ordinal in [`reminderTokenLookup.ts`](../../apps/desktop/src/lib/reminderTokenLookup.ts)). The app never writes `@~~…~~` locally on check. Unchecking Completed unstrikes via a normal editor persist (`formatDateToken` without `struck`).
- **Live apply:** clicking a calendar day, **Today**, or changing time fields (hour, minute, **No time**) updates the document token immediately while the overlay stays open. `Enter` applies the current selection without closing. `Esc` or **Cancel** dismisses the overlay. Arrow keys move the calendar selection without applying until `Enter` or a day click.
- **Defaults:** today’s date; no time pre-selected on a fresh `@` trigger. When time is enabled (uncheck **No time**), the picker prefills **now + 15 minutes**, snapped to the nearest 5-minute boundary.

Storybook sandbox: [`dateToken/__sandbox__/DateTimePicker.stories.tsx`](../../apps/desktop/src/editor/noteEditor/dateToken/__sandbox__/DateTimePicker.stories.tsx).

## Confirm and cancel semantics

Orchestration lives in [`NoteMarkdownEditor.tsx`](../../apps/desktop/src/editor/noteEditor/NoteMarkdownEditor.tsx).

| Open reason | Replace range | Trailing space on confirm |
|-------------|---------------|---------------------------|
| Typed `@` (new token) | From `@` through current caret | Yes (`@YYYY-MM-DD `) |
| Click existing chip | Entire validated token span | No |

- **Cancel / Esc:** overlay closes; document text is unchanged (the lone `@` or existing token stays as typed).
- **Apply** (day click, **Today**, time change, or `Enter`): `formatDateToken` result is dispatched as a CodeMirror transaction without closing the overlay.
- **Dismiss** (`Esc`, **Cancel**, outside pointerdown, editor scroll): overlay closes; applied token text is kept.

Overlay is portaled to `document.body`, positioned with `view.coordsAtPos` (fallback: editor host top-left inset). After mount, measured overlay size is clamped into the viewport (`clampDateTokenPickerOverlayPosition` in [`dateTokenPickerOverlayPosition.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenPickerOverlayPosition.ts)): horizontal inset 8px; prefer below the anchor with a 6px gap, flip above when the bottom would overflow, then clamp top. Editor scroll dismisses the overlay (anchor is not re-followed on scroll).

## Pill variants (non-focused lines)

| Variant | Glyph | Modifier class | When |
|---------|-------|----------------|------|
| Upcoming | 🔔 | (default) | Live token, moment not yet past |
| Past | ☑️ | `cm-date-token-pill--past` | Live token, moment passed |
| Completed | ✔️ | `cm-date-token-pill--completed` | Struck `@~~…~~` (styling wins over `--past`) |

Completed pills use structured DOM (`cm-date-token-pill__emoji` + `cm-date-token-pill__label` with strikethrough on the label only). The minute clock relabels all pill variants.

## Inline chip rendering

Valid tokens receive a **mark decoration** on the **focused** line (editable plain text, not a replace widget). Struck tokens add `cm-date-token--completed`:

- ViewPlugin: [`dateTokenHighlightCodemirror.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenHighlightCodemirror.ts)
- Class: `cm-date-token`; attribute `data-date-token` for click detection
- Styles: [`dateTokenHighlight.css`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenHighlight.css) under `[data-app-surface='capture']` — subtle pill (monospace date, interactive accent color, pointer cursor on the chip)

Invalid or in-progress spans are not decorated. Multiple tokens per line are supported. On document changes, the ViewPlugin maps existing decorations through the change set and rescans only the lines touched by `iterChangedRanges` (full-document scan on initial mount only).

## Click to reopen

Clicking inside a decorated chip reopens the picker **pre-filled** from `parseDateToken`. On confirm, the **entire token range** is replaced.

Dual editing model:

- Users may **type** to edit the token text directly (caret can enter the mark).
- Clicking still places the caret; the picker is a **non-modal** overlay. `Esc` dismisses it so direct text editing remains the primary path when desired.

Click routing: [`dateTokenClick.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenClick.ts), wired from [`noteMarkdownPointerLinks.ts`](../../apps/desktop/src/editor/noteEditor/noteMarkdownPointerLinks.ts) in the existing editor `click` handler (after link activation checks).

Hit-testing uses `data-date-token` on the event target when present; otherwise the caret position must fall strictly inside the token (not on boundaries).

## Extension wiring

Registered in [`buildNoteMarkdownEditorExtensions.ts`](../../apps/desktop/src/editor/noteEditor/buildNoteMarkdownEditorExtensions.ts):

- `dateTokenHighlightExtensions()` — chip marks
- `dateTokenTriggerExtension(() => onOpenDateTokenPickerRef?.current)` — `@` input handler

`NoteMarkdownEditor` holds overlay state and assigns `onOpenDateTokenPickerRef` to open/replace via `buildDateTokenPickerOverlayState`.

**Read-only editors:** When `readOnly` is true, the picker does not open (`@` trigger or chip click) and `commit` does not dispatch document changes (CodeMirror's read-only facet blocks user input but not programmatic transactions, so both paths are gated explicitly).

**Out of scope (current):** Eskerra table cell editors (`noteMarkdownCellEditor.ts`) do not register the trigger or highlight extensions.

## Reminders (shipped — see the daemon plan)

The reminder layer that this grammar feeds is **implemented**. A separate headless
daemon (`eskerra-reminderd`, systemd `--user`) monitors all vault `.md` files for
these tokens, owns scanning/scheduling/OS notifications and the strikethrough
write-back, and writes a device-local reminder index that the desktop app reads
and renders in the Notifications pane. The Rust grammar in
`crates/eskerra-reminder-core` is a direct port of `dateToken.ts` (the canonical
source of the on-disk token format remains this document + `dateToken.ts`).

Authoritative contracts now live in:

- [`specs/plans/desktop-reminders-daemon-phased.md`](../plans/desktop-reminders-daemon-phased.md)
  — architecture, reminder identity, index/IPC schema, merge/state-migration,
  missed/grace + snooze semantics, and the phased build (Phases 0–7).
- [`specs/adrs/003-adr-reminder-daemon.md`](../adrs/003-adr-reminder-daemon.md)
  — the separate-daemon decision, cargo workspace layout, and the
  `RemoveReminder` failure contract.
- [`specs/observability/desktop-reminderd.md`](../observability/desktop-reminderd.md)
  — daemon + app observability signals.

What that layer adds on top of this grammar: reminder persistence/identity (path
+ normalized token text + occurrence ordinal, never byte offsets), date-only →
`dueAt` resolution via a configurable default time, the Notifications-pane dot
rule (due/overdue only; future reminders excluded), strikethrough removal
(`@~~…~~`), and click-to-open with caret-after-token. The **on-disk token format
is unchanged** — striking a token is the documented "no longer a reminder"
mutation, and the grammar already excludes `@~~…~~`.

Still out of scope here: mobile rendering (Android has no vault editor). Today Hub
read-mode pill picker and hub cell editors share the same overlay and Completed
semantics — see [`today-hub-editor-parity.md`](today-hub-editor-parity.md).

Any change to the on-disk token format must update this document **and**
`dateToken.ts` **and** the Rust `eskerra-reminder-core` grammar together — never
silently.
