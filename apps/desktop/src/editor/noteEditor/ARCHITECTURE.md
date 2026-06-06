# Desktop vault markdown editor (`noteEditor/`)

Navigation index for the CodeMirror 6 capture inbox editor. Product behavior and invariants live in [`specs/architecture/desktop-editor.md`](../../../../specs/architecture/desktop-editor.md).

## Start here

| Module | Role |
|--------|------|
| [`NoteMarkdownEditor.tsx`](NoteMarkdownEditor.tsx) | React orchestrator: mount `EditorView`, context menus, `sessionKey` remount |
| [`noteMarkdownEditorTypes.ts`](noteMarkdownEditorTypes.ts) | Public `NoteMarkdownEditorProps` / `NoteMarkdownEditorHandle` |
| [`useNoteMarkdownEditorShellRefs.ts`](useNoteMarkdownEditorShellRefs.ts) | Stable refs for shell callbacks, compartments, vault context |

## CodeMirror boot

| Module | Role |
|--------|------|
| [`buildNoteMarkdownEditorExtensions.ts`](buildNoteMarkdownEditorExtensions.ts) | Extension bundle + doc/fold/blur `updateListener` |
| [`noteMarkdownEditorPaste.ts`](noteMarkdownEditorPaste.ts) | Shared paste pipeline (main editor + table cells) |
| [`noteMarkdownPointerLinks.ts`](noteMarkdownPointerLinks.ts) | Wiki / relative / external link clicks |
| [`noteMarkdownCellEditor.ts`](noteMarkdownCellEditor.ts) | Single-line table cell editor extensions |

## Imperative document API

| Module | Role |
|--------|------|
| [`useNoteMarkdownEditorLoad.ts`](useNoteMarkdownEditorLoad.ts) | `loadMarkdown` apply path (preserve caret, folds, compartments) |
| [`noteMarkdownEditorImperativeHandle.ts`](noteMarkdownEditorImperativeHandle.ts) | `getMarkdown`, folds, wiki/link replace, `focus` |
| [`noteMarkdownLoadMarkdown.ts`](noteMarkdownLoadMarkdown.ts) | Pure load options + branch helpers (Vitest) |
| [`noteMarkdownDiffChanges.ts`](noteMarkdownDiffChanges.ts) | Minimal line-LCS replace for `selection: 'preserve'` |

## Tables (Eskerra v1)

Under [`eskerraTableV1/`](eskerraTableV1/): shell widget, nested cell editors, draft flush, clipboard. Parent editor registers link compartments via `eskerraTableParentLinkCompartmentsFacet`.

## Styling and language

| Module | Role |
|--------|------|
| [`markdownEskerraLanguage.ts`](markdownEskerraLanguage.ts) | Parser + fold rules |
| [`markdownEditorStyling.ts`](markdownEditorStyling.ts) | Appearance extensions |
| [`wikiLinkCodemirror.ts`](wikiLinkCodemirror.ts) / [`markdownRelativeLinkCodemirror.ts`](markdownRelativeLinkCodemirror.ts) | Link highlight plugins |

## Date tokens (`@YYYY-MM-DD`)

Spec: [`specs/architecture/desktop-date-token.md`](../../../../specs/architecture/desktop-date-token.md). Desktop capture editor only; plain-text tokens with optional pickers — no reminder model yet.

| Module | Role |
|--------|------|
| [`dateToken/dateToken.ts`](dateToken/dateToken.ts) | Grammar, `parseDateToken` / `formatDateToken`, scan patterns |
| [`dateToken/dateTokenHighlightCodemirror.ts`](dateToken/dateTokenHighlightCodemirror.ts) | ViewPlugin mark decoration (`cm-date-token`) |
| [`dateToken/dateTokenTrigger.ts`](dateToken/dateTokenTrigger.ts) | `@` at word boundary → open picker |
| [`dateToken/dateTokenClick.ts`](dateToken/dateTokenClick.ts) | Click chip → reopen picker pre-filled |
| [`dateToken/DateTimePicker.tsx`](dateToken/DateTimePicker.tsx) | Public re-export of picker UI |
| [`dateToken/dateTimePicker/`](dateToken/dateTimePicker/) | Calendar + time overlay: `calendar.ts`, `useDateTimePicker.ts`, presentational subcomponents |
