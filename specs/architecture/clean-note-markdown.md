# Clean this note (markdown normalization)

## Purpose

The desktop **Clean this note** action normalizes the **body** of the open vault markdown note (YAML frontmatter is unchanged). It ports the markdown phase from the legacy processors script (`processMarkDownContent`), exposed as `cleanNoteMarkdownBody` in `apps/desktop/src/lib/markdown/cleanNote`.

## User entrypoints

- **Toolbar:** brush icon next to Notifications (`EditorWorkspaceToolbar`).
- **Context menu:** editor right-click → **Clean this note** (shows OS-appropriate shortcut label).
- **Shortcut:** **Ctrl+E** (Windows/Linux) or **⌘E** (macOS) when focus is inside the capture markdown CodeMirror for the open note: the main inbox editor (`.inbox-root .cm-editor`) or an active Today Hub cell (`.today-hub-canvas .cm-editor`).

## Today Hub (weekly canvas)

When **Today Hub** is open under `Today.md` (`TodayHubCanvas`), the same **Clean this note** action also normalizes **each week row file** that belongs to that hub canvas (the same `rowUris` the canvas renders — “on the hub page,” not unrelated vault notes).

Implementation notes:

- Split each row body with `splitTodayRowIntoColumns`, run `cleanNoteMarkdownBody` **only on columns whose text is non-empty after trim**, then `mergeTodayRowColumns`. Never run the cleaner on the full merged row text, or hub section delimiters (`::today-section::`) could be damaged by remark.
- Use `CLEAN_PASTE_FRAGMENT_PLACEHOLDER_PATH` and **`insertH1FromFilename: false`** for those column fragments so week filenames do not inject an H1.
- Persist each changed row via `persistTodayHubRow` (same chain as hub autosave). Skip a row when a **blocking disk conflict** targets that row URI (`todayHubCleanRowBlocked`). If the open `Today.md` itself is in conflict, the whole clean action still bails out like other inbox saves.

## Cache and editor invariants

Cleaning updates the open editor via `loadFullMarkdownIntoInboxEditor` with the reconstructed full file (`mergeYamlFrontmatterBody`). On change, **`inboxContentByUri`** is updated with `mergeInboxNoteBodyIntoCache` for the current URI so it stays aligned with in-memory editor text (see `specs/architecture/desktop-editor.md`).

Cleaning is skipped when a **blocking disk conflict** applies to the open note (same guard pattern as autosave).

## Behavior summary

1. **Preprocess (line-based, fence-aware):** CRLF → LF, trim ends, heading/list/link/wiki-link spacing, optional hyphenated line-break join, inner space collapse.
2. **Token protection:** `[[wikilinks]]`, `@YYYY-MM-DD` / `@YYYY-MM-DD_HHMM` date tokens, `==highlights==`, issue-style `#123` / `\#123`, and blockquote admonition markers (`[!note]`, etc.) are tokenized so `remark` does not corrupt them.
3. **Remark:** `remark-parse` + `remark-gfm` → AST tweaks (optional H1 from filename stem, optional heading depth cap, link trim, optional empty list item removal) → `remark-stringify` with configurable markers.
4. **Restore tokens** → optional **emoji VS16** normalization (`emojiVariation.ts` + generated `emojiVariationBases.generated.ts`).
5. **Postprocess:** list spacing, optional tab indent for nested lists, blank lines between list items, blank lines around blocks, collapse duplicate blanks.

## Configurable taste (`CleanNoteOptions`)

All fields are optional; defaults match the legacy script. These exist so a future settings UI can override style without refactoring the core:

| Option | Role |
|--------|------|
| `bullet` | Unordered list marker (`-`, `*`, `+`). |
| `bulletOrdered` | Ordered marker (`.` or `)`). |
| `emphasis` / `strong` | `*` vs `_`. |
| `listItemIndent` | `tab` vs `one` (remark-stringify; tab conversion skipped when `one`). |
| `insertH1FromFilename` | Insert `# {stem}` when no H1. |
| `capHeadingDepthJumps` | Limit heading level jumps. |
| `removeEmptyListItems` | Drop empty list items in preprocess + AST. |
| `normalizeEmojiVs16` | Emoji variation / flag ZWJ normalization. |
| `rejoinHyphenatedLineBreaks` | Join `word-\nbreak` style breaks. |

**Always-on (not optional):** CRLF normalization, trailing whitespace trim, token protection/restoration, structural blank-line rules, wiki-link semantic preservation.

## Performance

Per note: synchronous `processSync` on one document; the remark `Processor` is memoized by resolved options key. Typical inbox notes stay in the low‑millisecond range on desktop hardware.

## Regenerating emoji VS16 bases

Unicode snapshot: `apps/desktop/scripts/data/emoji-variation-sequences.txt`.

```bash
pnpm --filter @eskerra/desktop generate-emoji-variation-bases
# or: node apps/desktop/scripts/generate-emoji-variation-bases.mjs
```

Writes `apps/desktop/src/lib/emojiVariationBases.generated.ts`.

## Tests

- `apps/desktop/src/lib/markdown/cleanNote/__tests__/*.test.ts` — unit and golden coverage.
- `apps/desktop/src/lib/desktopShortcutLabels.test.ts` — shortcut label for the menu.
- `apps/desktop/src/lib/todayHub/__tests__/cleanTodayHubRowColumns.test.ts` — merge helper for per-column hub clean (delimiter integrity, identity clean).
