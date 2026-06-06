# Desktop date tokens (`@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM`)

Desktop-only feature in the vault **capture** markdown editor (CodeMirror 6). Users can type or pick calendar dates (and optional 24-hour times) as plain-text tokens in notes. Tokens are **not** reminders yet — there is no reminder index, notification model, or Today Hub integration in this contract.

Module map: [`apps/desktop/src/editor/noteEditor/dateToken/`](../../apps/desktop/src/editor/noteEditor/dateToken/) (see [`ARCHITECTURE.md`](../../apps/desktop/src/editor/noteEditor/ARCHITECTURE.md)).

## Token grammar

```
DATE_TOKEN = "@" YYYY "-" MM "-" DD ( "_" HHMM )?
```

- **With time:** `@2026-12-28_2352` (hour and minute as two-digit 24-hour fields, no colon).
- **Without time:** `@2026-12-28` (the `_HHMM` suffix is omitted).

Single source of truth for parsing, formatting, and scan regexes: [`dateToken.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateToken.ts).

| Export | Role |
|--------|------|
| `DATE_TOKEN_PATTERN` | Document scan for chip decoration and click hit-testing (`(?:^|\s)(@…)`; group 1 is the token span). |
| `DATE_TOKEN_PREFIX_PATTERN` | Word-boundary check when the user has just typed `@`. |
| `parseDateToken(text)` | Returns `{year, month, day, hour?, minute?}` or `null` when syntax or calendar/time validation fails. |
| `formatDateToken(value)` | Builds the on-disk string (date-only when `hour` / `minute` are absent). |
| `isValidCalendarDate` | Leap-year aware month/day validation. |

**Validation:** A span is styled and treated as a date token only when `parseDateToken` succeeds. Invalid dates (for example `@2026-02-29`) and invalid times (for example `@2026-01-01_2560`) stay **plain unstyled text** so partial typing does not flash false chips.

## Word-boundary trigger

The date/time picker opens on a newly typed `@` only when `@` is at a **word boundary**:

- Start of line, or
- Immediately after whitespace.

This avoids false triggers inside email-like text (`foo@bar.com`). The `@` character **remains in the document**; the picker is a non-modal overlay, not a CodeMirror autocomplete dropdown.

Implementation: [`dateTokenTrigger.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenTrigger.ts) (`EditorView.inputHandler` + `DATE_TOKEN_PREFIX_PATTERN`).

## Picker UI

Presentational React overlay: [`DateTimePicker.tsx`](../../apps/desktop/src/editor/noteEditor/dateToken/DateTimePicker.tsx).

- **Calendar:** month grid with previous/next month navigation; week rows start on **Monday** (Fedora/GNOME reference).
- **Today:** prominent button sets the selected date to the current local calendar day.
- **Time:** hour and minute inputs (24-hour) plus a **No time** toggle. When **No time** is on, time inputs disable and confirm yields a date-only token.
- **Day pick / Cancel:** clicking a calendar day or **Today** commits immediately and closes the overlay. `Enter` confirms the current selection (for keyboard navigation and time tweaks). `Esc` cancels. Arrow keys move the calendar selection without committing until `Enter` or a day click.
- **Defaults:** today’s date; no time pre-selected on a fresh `@` trigger.

Storybook sandbox: [`dateToken/__sandbox__/DateTimePicker.stories.tsx`](../../apps/desktop/src/editor/noteEditor/dateToken/__sandbox__/DateTimePicker.stories.tsx).

## Confirm and cancel semantics

Orchestration lives in [`NoteMarkdownEditor.tsx`](../../apps/desktop/src/editor/noteEditor/NoteMarkdownEditor.tsx).

| Open reason | Replace range | Trailing space on confirm |
|-------------|---------------|---------------------------|
| Typed `@` (new token) | From `@` through current caret | Yes (`@YYYY-MM-DD `) |
| Click existing chip | Entire validated token span | No |

- **Cancel / Esc:** overlay closes; document text is unchanged (the lone `@` or existing token stays as typed).
- **Commit** (day click, **Today**, or `Enter`): `formatDateToken` result is dispatched as a CodeMirror transaction; editor refocuses.

Overlay is portaled to `document.body`, positioned with `view.coordsAtPos` (fallback: editor host top-left inset). After mount, measured overlay size is clamped into the viewport (`clampDateTokenPickerOverlayPosition` in [`dateTokenPickerOverlayPosition.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenPickerOverlayPosition.ts)): horizontal inset 8px; prefer below the anchor with a 6px gap, flip above when the bottom would overflow, then clamp top. Editor scroll dismisses the overlay (anchor is not re-followed on scroll).

## Inline chip rendering

Valid tokens receive a **mark decoration** (editable plain text, not a replace widget):

- ViewPlugin: [`dateTokenHighlightCodemirror.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenHighlightCodemirror.ts)
- Class: `cm-date-token`; attribute `data-date-token` for click detection
- Styles: [`dateTokenHighlight.css`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenHighlight.css) under `[data-app-surface='capture']` — subtle pill (monospace date, interactive accent color, pointer cursor on the chip)

Invalid or in-progress spans are not decorated. Multiple tokens per line are supported (global line scan).

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

**Out of scope (current):** Eskerra table cell editors (`noteMarkdownCellEditor.ts`) do not register the trigger or highlight extensions.

## Future reminders (deferred)

Parsing helpers in `dateToken.ts` are intentionally reusable so a later **reminder index** or notification layer can consume the same grammar. This spec does **not** define:

- Reminder persistence or metadata
- Today Hub rows or hub canvas integration
- Mobile rendering (Android has no vault editor)
- Read-only / preview surfaces outside the capture editor

When reminder behavior ships, extend or supersede this document with storage and UX contracts rather than changing the on-disk token format silently.
