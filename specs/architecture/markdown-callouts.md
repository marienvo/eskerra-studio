# Markdown callouts (Obsidian / GitHub alerts)

Eskerra renders **Obsidian-style** and **GitHub-compatible** callout blocks in markdown: a blockquote whose **first line** (after a single `>` level) matches `[!type]` with an optional title and optional fold markers `+` / `-` after `]`.

## Supported syntax

- **Header pattern** (first line of the blockquote, one `>` only on that line’s marker run — nested `> > [!tip]` on one line is **not** a callout):
  - `> [!tip]`
  - `> [!warning] Some warning`
  - `> [!info]+` (fold marker ignored for display in v1)
- **Case-insensitive** type token inside brackets (`[!TIP]` ≡ `[!tip]`).
- **Custom title**: text after `]` (trimmed). If omitted, the **catalog default label** is shown in the UI (desktop: via CSS `::after` when the bracket token is hidden; mobile: header row text).

## Catalog and aliases

Canonical types, **Material Icons** ligature names, color keys, default labels, and aliases live in **`@eskerra/core`**: [`packages/eskerra-core/src/markdown/callouts.ts`](../../packages/eskerra-core/src/markdown/callouts.ts) (`CALLOUT_CATALOG`, `resolveCallout`, `matchCalloutHeader`).

- Unknown bracket types resolve to **`note`** (blue / `edit` icon).

## Platform behavior

| Area | Implementation |
| ---- | ---------------- |
| **Desktop** | CodeMirror `ViewPlugin` [`apps/desktop/src/editor/noteEditor/markdownCallouts.ts`](../../apps/desktop/src/editor/noteEditor/markdownCallouts.ts) + CSS in [`apps/desktop/src/App.css`](../../apps/desktop/src/App.css). Line classes on every line of the Lezer `Blockquote`; a **mark** decoration hides the `[!type](+/-)?` span on non–marker-focus lines (same pattern as other syntax marks). |
| **Mobile reader** | `react-native-markdown-display` **`rules.blockquote`** in [`apps/mobile/src/features/vault/markdown/calloutRule.tsx`](../../apps/mobile/src/features/vault/markdown/calloutRule.tsx), wired from [`NoteDetailScreen`](../../apps/mobile/src/features/vault/screens/NoteDetailScreen.tsx). The AST’s first paragraph plain text is matched as `> ` + first line (markdown-it does not keep `>` in paragraph text). |
| **Hub / table static rich** | Same desktop plugin + shared callout CSS selectors for [`.today-hub-canvas__cell-static-rich`](../../apps/desktop/src/App.css) and [`.cm-eskerra-table-shell__cell-static-rich`](../../apps/desktop/src/App.css). |

Parity with other cross-platform markdown behavior is summarized in [`desktop-mobile-parity.md`](desktop-mobile-parity.md).

## Clean / normalize pipeline

**“Clean this note”** already preserves `> … [![…]` markers through remark via token substitution — see [`apps/desktop/src/lib/markdown/cleanNote`](../../apps/desktop/src/lib/markdown/cleanNote/index.ts) and [`clean-note-markdown.md`](clean-note-markdown.md). Callout rendering does **not** change source text.

## Out of scope (v1)

- **Foldable** callouts (`+` / `-` UI).
- **Insert/snippet** UI for callouts in the editor.
- **Nested** callout-only parsing beyond “single `>` marker run on the header line”.
- **Editing** the synthetic title row on mobile (read-only detail view only).

## Tests

- **Core:** [`packages/eskerra-core/src/markdown/callouts.test.ts`](../../packages/eskerra-core/src/markdown/callouts.test.ts)
- **Desktop:** [`apps/desktop/src/editor/noteEditor/__tests__/markdownCallouts.test.ts`](../../apps/desktop/src/editor/noteEditor/__tests__/markdownCallouts.test.ts)
