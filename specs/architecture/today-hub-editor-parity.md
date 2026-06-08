# Today Hub: read (static) vs edit (CodeMirror) typography parity

## Goal

Inactive hub cells render markdown as static DOM ([`TodayHubCellStaticRichText`](../../apps/desktop/src/components/TodayHubCellStaticRichText.tsx)) with the same `cm-md-*` classes as CodeMirror. Active cells use [`NoteMarkdownEditor`](../../apps/desktop/src/editor/noteEditor/NoteMarkdownEditor.tsx). **Bullet lists and body lines must not shift vertically** when switching read ↔ edit or when comparing two columns side by side.

## Shared tokens

Both modes sit under [`.note-markdown-editor-wrap`](../../apps/desktop/src/App.css), which defines `--nb-editor-font-size` and `--nb-editor-line-height`.

Hub uses a slightly tighter line box than the main inbox editor (historical ratio **1.5625 / 1.6** vs main):

- **Edit:** `[data-app-surface='capture'] .today-hub-canvas__cm-host .note-markdown-editor-host .cm-scroller` sets `line-height: calc(var(--nb-editor-line-height) * 1.5625 / 1.6)`.
- **Read:** `.today-hub-canvas__cell-static-rich` sets the same `line-height` and `font-size: var(--nb-editor-font-size)`.

## Pitfall (regressed before): extra `min-height` on static `.cm-line`

Static lines use `<div class="cm-line">` per row. There is **no** matching `min-height` on CodeMirror `.cm-line` in hub edit mode.

If static rules add:

```css
min-height: calc(1em * var(--nb-editor-line-height) * 1.5625 / 1.6);
```

then `getComputedStyle` still reports the **same** `line-height` as CodeMirror (~22.7px at 15px / 1.55 base), but **layout can round differently**: static lines may get **`clientHeight` one pixel taller** than CodeMirror lines, so bullets appear to “jump” vertically.

**Rule:** Hub static `.cm-line` must rely on **inherited `line-height` only** (plus normal block/heading/list padding from shared `cm-md-*` rules). Do not add **universal** per-line `min-height`: it inflated `clientHeight` vs CodeMirror on lines that already had text.

**Exception — blank lines:** Empty markdown lines render as `:empty` `.cm-line` nodes with no strut; they collapse without `min-height`. Use **`.cm-line:empty` only** with `min-height: 1lh` so the blank line’s block size matches the **used** hub line height (inherited from `.today-hub-canvas__cell-static-rich`). Do **not** use `calc(1em * var(--nb-editor-line-height) * 1.5625 / 1.6)` here: it can round **1px taller** than CodeMirror lines while `line-height` still matches on paper.

## Horizontal inset (read vs edit)

Body text must start at the **same** horizontal offset in:

- `.today-hub-canvas__cell-readonly` (`padding-inline-start`), and
- `.today-hub-canvas__cm-host .note-markdown-editor-host .cm-content` (`padding-inline` start).

**Single token:** `.today-hub-canvas__cell` defines `--today-hub-body-pad-inline-start`. Both rules consume it. Do not duplicate `calc(0.6rem + … - Npx)` with different `N` (a prior bug used `-19px` on readonly and `-30px` on `.cm-content`, shifting edit mode ~5–6px left vs read in WebKit).

**`ch` / font-size:** `--nb-editor-heading-gutter` is `9.25ch`. `ch` resolves against the element’s **used font size**. Hub cells must set `font-size: var(--nb-editor-font-size)` on **`.today-hub-canvas__cell`** so readonly (which would otherwise inherit `0.88rem` from `.today-hub-canvas`) uses the same `ch` width as `.cm-scroller` / `.cm-content`. Otherwise `padding-inline` can match **by token** but diverge **by computed px** (~5px).

**Debug:** Log `getComputedStyle(readonly).paddingInlineStart` vs `getComputedStyle(.cm-content).paddingInlineStart` for the same row; they must match.

## List indentation (read vs edit)

CodeMirror’s `.cm-content` uses **`white-space: break-spaces`** (see `@codemirror/view` base theme) and the default **`EditorState.tabSize` facet value of 4** (tabs in the document render at four columns).

Hub static preview used **`white-space: pre-wrap`** without an explicit `tab-size`, so nested lists could look **more indented in read mode** than in edit (browser default tab width and different wrapping rules).

**Rule:** `.today-hub-canvas__cell-static-rich` must use **`white-space: break-spaces`** and **`tab-size: 4`** so list lines match the editor’s horizontal spacing.

## Link snippet parity

When a cell line contains **only** a bare `http(s)://` URL (optionally preceded by a list marker or
GFM task checkbox — i.e. the same set that `parseLoneLinkLine()` matches), both modes must render a
rich link preview card:

- **Edit mode:** `linkRichPreviewExtension()` in
  [`linkRichPreviewCodemirror.ts`](../../apps/desktop/src/editor/noteEditor/linkRichPreviewCodemirror.ts)
  decorates the line with a `LinkRichPreviewWidget`.
- **Read mode:** `TodayHubCellStaticRichText` calls `parseLoneLinkLine()` on each line and renders a
  [`LinkRichPreviewCard`](../../apps/desktop/src/components/LinkRichPreviewCard.tsx) in place of the
  normal span segments.

Both use the **same** IndexedDB + memory cache (`linkRichPreviewCache.ts`) and the same CSS classes
(`cm-link-rich-preview`, `cm-link-rich-preview--inline`, `cm-link-rich-preview--with-image`,
`cm-link-rich-preview--no-image`).

**Rule:** Any change to the card's visual structure, the lone-link-line detection heuristic
(`parseLoneLinkLine`), or the cache API must be applied to **both** the CodeMirror widget and the
React component. The two entry points are:

1. `LinkRichPreviewWidget.toDOM()` — imperative DOM build in `linkRichPreviewCodemirror.ts`
2. `LinkRichPreviewCard` — declarative React in `LinkRichPreviewCard.tsx`

## Reminder pill parity

Date tokens (`@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM`, or struck `@~~…~~`) render as a pretty pill
(`🔔 Tomorrow 12:00`, `☑️ …` once past, or `✔️ …` with strikethrough label when completed) on any
**non-focused** line. Both modes must show the pill:

- **Edit mode:** `dateTokenHighlightExtensions()` in
  [`dateTokenHighlightCodemirror.ts`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenHighlightCodemirror.ts)
  replaces the token with a `DateTokenPillWidget` on lines without the caret.
- **Read mode:** `TodayHubCellStaticRichText` calls
  [`todayHubStaticLineParts()`](../../apps/desktop/src/lib/todayHub/todayHubCellStaticDateTokenPill.ts)
  per line and renders a `cm-date-token-pill` span in place of the raw token segments.

Both share the pill classes (`cm-date-token-pill`, `cm-date-token-pill--past`,
`cm-date-token-pill--completed`) and CSS in
[`dateTokenHighlight.css`](../../apps/desktop/src/editor/noteEditor/dateToken/dateTokenHighlight.css),
and the same label/past helpers (`formatDateTokenPretty`, `isDateTokenInPast`). Read mode runs an
aligned **minute clock** (only when the cell contains a pill) so labels relabel and flip past on the
same cadence as the editor.

**Read-mode picker:** clicking a pill in an inactive cell opens the shared
[`DateTokenPickerOverlay`](../../apps/desktop/src/editor/noteEditor/dateToken/DateTokenPickerOverlay.tsx)
(portaled picker). `pointerdown` on the pill calls `stopPropagation()` so the cell does not also
activate. Confirm splices the token via `applyTodayHubCellDateTokenReplace` (updates
`localRowSections` without opening the cell) and `schedulePersist`. Pill `data-doc-from` /
`data-doc-to` cover the **full** struck span (`@~~…~~`), not the inner date.

**Rule:** the read-mode pill placement (`collectDateTokenPillsForLine`) must mirror CodeMirror's
`collectDateTokenRangesForLine` token detection; any change to the pill label, glyphs, classes, or
token pattern must be applied to **both** entry points.

**Pitfall (the bug this fixed):** read mode previously rendered only the Lezer/wiki/link segments,
so date tokens showed as raw `@…` text until the cell was activated. Static rendering must replicate
every CodeMirror **widget** decoration (pills, link preview cards), not just inline mark classes.

**Click-to-edit offsets:** pill spans carry `data-doc-from` / `data-doc-to` (source token range in
`cellText`). `mapTodayHubStaticRenderedLineOffsetToDocOffset` in
[`todayHubCellStaticPointer.ts`](../../apps/desktop/src/lib/todayHub/todayHubCellStaticPointer.ts)
rewrites pointer-derived offsets from rendered DOM length back to document offsets so activating a
readonly cell places the caret on the raw `@date` token, not on the shorter pretty label.

## Debug checklist

1. Compare `getComputedStyle(.cm-scroller)` vs `getComputedStyle(.today-hub-canvas__cell-static-rich)` for `font-size` and `line-height`.
2. Compare **first** `.cm-line` under each: `line-height`, **`min-height`**, and **`clientHeight`**. Mismatched `clientHeight` with identical `line-height` strongly suggests an extra static-only constraint (often `min-height`).
3. Compare **horizontal:** `paddingInlineStart` on readonly vs hub `.cm-content` (see above).
4. Compare **`whiteSpace`** and **`tabSize`** on `.today-hub-canvas__cell-static-rich` vs hub `.cm-content` (see “List indentation”).

## Related CSS entry points

- Hub canvas: `.today-hub-canvas`, `.today-hub-canvas__cell-static-rich`, `.today-hub-canvas__cm-host`
- Editor tokens: `.note-markdown-editor-wrap` in [`App.css`](../../apps/desktop/src/App.css)
