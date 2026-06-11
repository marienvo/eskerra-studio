# Android vault notes rebuild specification

This document captures **all product behavior** of the current Eskerra Android app (`apps/mobile`) for **Inbox note I/O** (read, edit, add, delete) and **read-only vault surfaces** (wiki links, Today Hub, full-vault search, markdown images). It is written so a **different Android app** can reproduce the same outcomes against the **same vault on disk**, with **dark mode only**.

**Reference implementation:** `apps/mobile/` + shared logic in `packages/eskerra-core/`, `packages/eskerra-tokens/`.

**Companion specs:**
- Vault search (native index): [`specs/architecture/mobile-vault-search.md`](../architecture/mobile-vault-search.md)
- Read-only link colors: [`specs/design/vault-readonly-link-colors.md`](../design/vault-readonly-link-colors.md)
- Shared vault contract: [`specs/architecture/desktop-mobile-parity.md`](../architecture/desktop-mobile-parity.md)

**Out of scope for this document:** Episodes/podcasts tab, playlist/R2, Record tab, Settings (except vault bootstrap assumptions), iOS.

---

## 1. Purpose and parity definition

**Parity definition:** Given the same user-selected vault directory (via Android Storage Access Framework tree URI), the rebuild app must produce **equivalent file contents and user-visible outcomes** for:

| Area | Parity target |
| ---- | ------------- |
| Inbox list | Same notes, sort order, titles, dates, tile colors |
| Inbox compose | Same markdown file shape on create/edit |
| Inbox delete | Same files removed; same safety checks |
| Inbox detail (read) | Same rendered markdown (callouts; no wiki navigation in inbox detail today) |
| Vault read (search / Today / linked notes) | Wiki links, relative `.md` links, external links, tables, callouts, images¹ |
| Today Hub | Same hub discovery, week navigation, column layout, intro + row rendering |
| Vault search | Same ranking tiers, snippets, debounce, incremental index behavior |

Platform implementation (React Native vs native UI, Kotlin vs Rust index) may differ; **behavior and on-disk format must not.**

¹ **Images:** the reference app renders only **remote** (`http(s)://`/`data:`) images; **local** vault attachments are not resolved today (§13.2). Local-image display is an explicit enhancement for the rebuild, not a parity requirement.

---

## 2. Platform and vault assumptions

### 2.1 Android only

- Target **Android** with **SAF** (`content://` tree URI) as the vault root.
- **Dark mode only** for the rebuild app (see §10). The reference app still supports light mode in some code paths; ignore light palettes when rebuilding.

### 2.2 Vault layout (on disk)

| Path | Role |
| ---- | ---- |
| `Inbox/*.md` | User-authored inbox notes (create/edit/delete scope) |
| `Assets/Attachments/*` | Image files referenced from markdown (`../Assets/Attachments/...` from Inbox notes) |
| `General/` | Podcast markdown (read-only in this spec) |
| `.eskerra/settings-shared.json` | Vault-scoped settings (not required for notes MVP but same vault) |
| `.eskerra/settings-local.json` | Per-device settings (not synced) |

**Hard-excluded from vault-wide markdown index** (not indexed, not wiki targets): directories named `Assets`, `Excalidraw`, `Scripts`, `Templates` **at any depth** (the filter runs at every recursion level, so e.g. `Projects/Assets/private.md` is also excluded); dot-prefixed names; `*.md.sync-conflict-*` sync conflict files. Logic: `packages/eskerra-core/src/vaultVisibility.ts`.

### 2.3 SAF URI convention

Note URIs follow **direct suffix** form, not standard SAF document IDs:

```
content://…/tree/<vaultRoot>/Inbox/note.md
```

Both `react-native-saf-x` and Kotlin listing use this convention. All path logic in `@eskerra/core` assumes it. When rebuilding with SAF, preserve `content://` scheme through resolve/link operations.

### 2.4 Shared TypeScript core

Reuse or reimplement these `@eskerra/core` modules for identical behavior:

- Inbox compose: `inboxComposeNote.ts`, `inboxMarkdown.ts`
- Today Hub: `todayHub/*`
- Wiki links: `wikiLinkInbox.ts`, `vaultRelativeMarkdownLink.ts`
- Attachments: `attachments/attachmentPaths.ts`, `attachments/imageSniff.ts`
- Search types/highlights: `vaultSearch/vaultSearchTypes.ts`, `vaultSearch/vaultSearchHighlight.ts`
- Callouts: `calloutHeader.ts` (via `matchCalloutHeader` / `resolveCallout`)
- Datetime labels: `datetime/relativeCalendarLabel.ts`
- Inbox tile color: `inbox/inboxTileColor.ts`

---

## 3. Navigation map (reference app)

| Tab / stack | Screens relevant to this spec |
| ----------- | ------------------------------ |
| **Inbox** | `InboxScreen` → `NoteDetailScreen` → `AddNoteScreen` (edit) |
| **Entry** | `AddNoteScreen` (create) |
| **Today** (Vault tab) | `VaultScreen` → `VaultNoteReadScreen` (linked notes); `VaultSearchScreen` |
| Tab bar | Week prev/next when Today hub visible (`VaultTodayHubContext`) |

Search is opened from the Today tab header (magnifier). Picking a search result opens `VaultNoteReadScreen` on top of search (back restores query + results).

---

## 4. Inbox — list (`InboxScreen`)

### 4.1 Data source

- List **`Inbox/`** markdown files only (`listNotes(baseUri)` → SAF directory listing).
- Sort: **`lastModified` descending**, tie-break **`name` localeCompare ascending** (`NotesContext.sortByLastModifiedDesc`).
- Exclude sync conflict filenames (`isSyncConflictFileName`).
- Pull-to-refresh re-lists; initial load may use native session prefetch (`tryPrepareEskerraSessionNative`) — optional optimization, not required for parity if listing is correct.

### 4.2 Row display

For each note:

1. **Title line:** first `# H1` from cached or loaded body if available (`extractFirstMarkdownH1`); else `getNoteTitle(fileName)` (stem with `-`/`_` → spaces).
2. **Subtitle:** raw filename (e.g. `Meeting notes.md`).
3. **Meta:** `formatRelativeCalendarLabel(lastModified)` — `Today`, `Yesterday`, weekday name within last week, else `YYYY-MM-DD`; `null` → em dash.
4. **Avatar tile:** 40×40 rounded square, background from `getInboxTileBackgroundColor(lastModified, now)` (blue gradient decay over ~4 weeks, then neutral gray).

### 4.3 Interactions

- **Tap row body:** navigate to `NoteDetail` with `{ noteUri, noteFileName, noteTitle }`.
- **Tap avatar:** toggle multi-select for that URI.
- **Multi-select header:** back clears selection; title `N selected`; trash deletes selected.
- **Delete:** calls `deleteNotes(uris)` — see §7. Shows spinner on delete icon while in flight.
- **Settings icon** (no selection): opens Settings tab.
- **Share intent draft:** on focus, if pending share draft exists, navigate to `AddNote` with `initialComposeText`.

Empty state: *"No markdown entries found in Inbox. Add one via the Entry tab."*

### 4.4 Content cache

`VaultContext` maintains `inboxContentByUri` (in-memory). After successful read/write/create, cache must reflect latest text so list H1 titles and detail views stay consistent without redundant SAF reads.

---

## 5. Inbox — read (`NoteDetailScreen`)

### 5.1 Loading

- Prefer cache hit from `getInboxNoteContentFromCache(noteUri)`.
- On focus, `read(noteUri)` loads full file from SAF if needed.
- Silent reload on refocus if note was loaded once (no full-screen spinner flash).

### 5.2 Markdown processing

1. `splitYamlFrontmatter(content)` — if frontmatter present, render **body only** (same as vault read views).
2. Empty body → display italic *Empty entry*.
3. **No wiki-link preprocessing** in inbox detail (standard markdown links only; wiki `[[...]]` appear as plain text unless the renderer handles them — reference app does **not** resolve wiki in inbox detail).
4. **Callouts:** `createCalloutMarkdownRules(colorMode)` — Obsidian-style `> [!type]` blocks.

> **Inbox detail is a separate, intentionally limited renderer** — *not* the shared read-only renderer of §8. `NoteDetailScreen` installs **only** the callout rules: no wiki resolution, no `createVaultReadonlyMarkdownRules`, no vault-link colors, no custom table/image rules, and no `eskerra-wiki:` preprocessing. Links use a flat blue `#4f9dff` (not the §8.3 token colors). Internal `.md`/wiki targets are therefore **not** navigable from inbox detail by design. Do not route inbox detail through the full vault renderer when rebuilding.

### 5.3 Edit affordance

Header right: edit icon → `AddNote` with `{ noteUri, noteTitle }`.

Stack header shows **filename** (not H1 title). Tab header hidden while detail is focused.

---

## 6. Inbox — compose, create, edit (`AddNoteScreen`)

### 6.1 Compose model

Single multiline `TextInput`. Format (`@eskerra/core` `parseComposeInput` / `buildInboxMarkdownFromCompose`):

```
<title line>
<blank line optional>
<body lines>
```

- **First line** = title (required).
- **Remaining lines** after first newline = body (trimmed). Body may be empty.

### 6.2 Persisted markdown shape

| Case | File content |
| ---- | ------------ |
| Title only | `# {title}\n` |
| Title + body | `# {title}\n\n{body}` |

Title in H1 is the **logical title**; **filename stem** comes from sanitized title (see §6.3).

### 6.3 Create (`createNote`)

1. `sanitizeFileName(title)` → filesystem stem (illegal chars stripped, whitespace collapsed, fallback `note-{timestamp}`).
2. `pickNextInboxMarkdownFileName(stem, occupiedNames)` → `{stem}.md`, then `{stem}-2.md`, etc.
3. Ensure `Inbox/` exists (`mkdir` if missing) — must precede the write, since SAF write to a missing parent fails.
4. Write UTF-8 to `{inboxDir}/{fileName}`.
5. After create: update search index (`touchVaultSearchNoteUris`), markdown registry (`touchMarkdownNoteUris`), refresh vault markdown refs, optimistic list merge, silent list refresh.

**Navigation after create:** replace/navigate to `NoteDetail` for new note.

### 6.4 Edit (`writeNoteContent`)

- Overwrite same URI with new markdown (full file replace).
- Validate: title required; **content length > 0** (`useSaveInboxMarkdownNote` — empty file rejected).
- After write: same index touches + cache update + list refresh as create.

### 6.5 Edit load

`inboxMarkdownFileToComposeInput(note.content)` inverts H1 file → compose field (strips `# ` H1, blank lines after H1; if no H1, first line = title).

### 6.6 UX details (reference)

- Auto-focus input after navigation (Android: 250 ms delay after interactions).
- Keyboard-aware sticky save bar; mini-player/tab bar inset when podcast playing (ignore if rebuild has no player).
- Save errors surfaced as status text under field.

---

## 7. Inbox — delete

### 7.1 Rules

- Only notes verified under **`Inbox/`** (`isNoteUriInInbox`) may be deleted.
- Handles SAF canonical URI variants (document ID encoding) — see `isNoteUriInInbox` fallback decode.
- **Multi-delete:** map each selected URI to canonical list entry by exact URI or unique filename match; if any URI cannot be resolved → error *"Could not delete selected entries because one or more entries are no longer available…"*
- Delete = **`unlink`** each file (no trash folder).
- After delete: remove from search index, markdown registry, prune content caches, update list.

Error message if outside Inbox: *"Could not verify that the selected entry belongs to Log."* (legacy copy — parity includes this string).

---

## 8. Read-only vault markdown (shared renderer)

Used by: `NoteContentView`, `VaultReadonlyMarkdownBlock`, `VaultNoteReadScreen`.

### 8.1 Pipeline

1. Load note body (cache → SAF read).
2. Strip YAML frontmatter for display.
3. **`preprocessVaultReadonlyMarkdownBody`:** rewrite `[[wiki inner]]` → synthetic link `[label](eskerra-wiki:{encodeURIComponent(inner)})` **outside** ` ``` fenced ``` ` blocks only.
4. Render with `react-native-markdown-display` (or equivalent) with custom rules:
   - `createCalloutMarkdownRules`
   - `createVaultReadonlyMarkdownRules`

### 8.2 Standard markdown

Support at minimum:

- Headings, paragraphs, bold/italic/strike, lists, blockquotes, fenced code, inline code, horizontal rules
- **Tables:** horizontal scroll wrapper; cell min/max width; bordered cells
- **External links:** `http`, `https`, `mailto` → system browser (`Linking.openURL`)
- **Images:** see §9

### 8.3 Link colors (dark mode)

From `@eskerra/tokens` `vaultReadonlyMarkdownLinkColors('dark')`:

| Kind | Hex | Used for |
| ---- | --- | -------- |
| Internal note | `#FF8A82` | Resolved wiki + relative `.md` vault links |
| External site | `#7DCCFF` | Browser URLs |
| Muted body | `#cfcfcf` | Unresolved links (when index ready) |

While vault markdown index is **loading**, unresolved internal links use **internal color** (optimistic). After **error**, unresolved use muted.

**RN quirk:** link label `Text` nodes must have color forced on entire subtree (`withVaultReadonlyLinkTextColor`) or inherited body color overrides link hue.

### 8.4 Body typography (dark)

| Element | Color / background |
| ------- | ------------------ |
| Body text | `#f5f5f5` |
| Muted / filename | `#cfcfcf` |
| Code block/inline/fence bg | `rgba(255,255,255,0.08)` |
| Code border | `rgba(255,255,255,0.12)` |

### 8.5 Vault markdown index (wiki + relative links)

**Registry:** all eligible `.md` files in vault → `{ uri, name, lookupName, displayName }`.

- Primary source: native SQLite table `vault_markdown_notes` via `readVaultMarkdownNotes(baseUri)` when `notesRegistryReady`.
- Fallback: SAF walk (`tryListVaultMarkdownRefsNative`).

**Status:** `loading` | `ready` | `error`. UI hints:

- Loading + empty registry: *"Indexing vault notes for links…"*
- Error: *"Link name index unavailable ({error}). Wiki links may not resolve until the vault is reachable again."*

Refresh: user can retry from wiki-link error alerts (*Retry* → `refreshVaultMarkdownRefs`).

---

## 9. Wiki links and internal navigation

### 9.1 Syntax

- `[[Target]]`, `[[Target|Display]]`, `[[Inbox/Target]]`
- Path-shaped: `[[folder/note.md]]`, `[[../Other/note.md]]` — resolved via vault-relative rules, not inbox stem match
- Browser in wiki target: `[[https://example.com]]` or `[[https://example.com|Label]]`

### 9.2 Resolution (`resolveInboxWikiLinkTarget`)

For **non-path** targets (no `/` or `\` in target after optional `Inbox/` strip):

1. Exact stem match on indexed note **filename stem**
2. Case-folded stem match (single hit → open; records `canonicalInner` for rewrite)
3. Sanitized stem key match (`sanitizeInboxNoteStem` lowercase)
4. Multiple matches → **ambiguous** picker modal (list candidate titles + URIs)
5. No match + index ready → alert *"Note not found"*
6. No match + index loading → *"Still indexing vault"*
7. Index error → *"Vault index unavailable"* + Retry

**Path-shaped wiki links:** `wikiLinkInnerVaultRelativeMarkdownHref` + `resolveVaultRelativeMarkdownHref` with source directory rules:

- `./` / `../` → relative to **current note URI**
- Bare paths (e.g. `_backup/General/x.md`) → relative to **vault root**
- `Inbox/foo` prefix → relative to **Inbox directory**

### 9.3 Standard markdown relative links

`[label](../path/note.md)` — same `resolveVaultRelativeMarkdownHref` as desktop; open internal note on press.

Non-markdown paths, empty targets, unresolvable → alerts (*"Link cannot be opened from read-only view"*, etc.).

### 9.4 Navigation stack

`VaultNoteReadScreen`: push on internal link (`navigation.push('VaultNoteRead', { noteUri, noteTitle })`). Header: back, title = note title, search icon still available.

`NoteContentView` without `onNavigateToVaultNote` → alert *"Navigation unavailable"*.

---

## 10. Dark mode UI contract (rebuild)

Rebuild app is **dark mode only**. Match reference dark chrome:

| Surface | Typical value |
| ------- | ------------- |
| Tab/header background | Dark chrome with **white** `#ffffff` header text and icons |
| Tab bar | White active tint; inactive `rgba(255,255,255,0.72)` |
| List dividers | `#333333` (`LIST_DIVIDER_DARK`) |
| Screen background | App default dark (Gluestack `dark` in reference) |
| Modal sheets (hub picker, wiki ambiguous) | Background `#1d1d1d`–`#1e1e1e`; title `#f5f5f5`; subtitle `#b0b0b0` |

Do not ship light-mode-specific palettes in the rebuild; `@eskerra/tokens` dark link colors (§8.3) are authoritative.

---

## 11. Today Hub

### 11.1 Discovery

- **Hub note:** any indexed markdown file named **`Today.md`** (stem `Today` on SAF where URI tail is opaque).
- Multiple hubs: sorted URI order; user picks active hub if >1 (`TodayHubPickerModal`).
- **Persist** last active hub URI in AsyncStorage (`activeTodayHubStorage`) so cold start prefetches correct hub.
- Tab title = **parent folder name** of `Today.md` (`todayHubFolderLabelFromTodayNoteUri`).

### 11.2 Hub intro (`Today.md`)

Load full file. Parse frontmatter (`parseTodayHubFrontmatter`):

```yaml
---
perpetualType: weekly   # only 'weekly' supported
start: monday           # sunday|monday|…|saturday
columns:                # optional extra column headers (list or single scalar)
  - Reflection
  - Tasks
---
```

- **Column count** = `1 + columns.length` (first column is always the date column).
- Intro **body** (after frontmatter) rendered as first markdown block (wiki links active).

### 11.3 Week rows

- Row files: **`YYYY-MM-DD.md`** beside `Today.md` (Monday-stem naming via `formatTodayHubMondayStem(weekStart)` — stem is the **week start date** per hub `start` setting, not always Monday calendar).
- Row body split into columns by `splitTodayRowIntoColumns(fullText, columnCount)`. **Do not split on the literal string `\n\n::today-section::\n\n`** — the canonical merge delimiter is `TODAY_HUB_SECTION_DELIMITER` (`'\n\n::today-section::\n\n'`), but reading **must** use the tolerant split regex from `splitMergeTodayRowColumns.ts`:
  - `/(?:\n\n|\n)[ \t]*::today-section::[ \t]*(?:\n\n|\n(?=[^\n])|$)/g`
  - i.e. paragraph break before the marker (`\n\n` preferred, single `\n` allowed), only horizontal spaces (`[ \t]*`, **never** `\s*`) on the marker line, then a blank line / single newline / EOF after it.
  - Normalize `\r\n` → `\n` first.
  - Exactly one column → whole text. `columnCount > 1` but no delimiter present → column 0 = whole text, remaining columns empty. **More** delimited chunks than columns → extra chunks merged into the **last** column (re-joined with the canonical delimiter).
- Missing row file → empty columns (read empty string).
- Strip stray delimiter-only lines from each column body before display (`stripTodayHubDelimiterOnlyLinesFromColumn`: drop any line matching `/^\s*::today-section::\s*$/`).

### 11.4 Week navigation

- On hub load: `enumerateTodayHubWeekStarts(now, settings.start)` → 53 week anchors; sync selected week to **`weekStarts[1]`** (anchor = previous week start + current week context).
- **Prev/next** jumps only to weeks that **exist on disk** (stems collected from vault markdown index beside active hub).
- Subtitle between tab bar arrows: short week range (`formatTodayHubWeekRangeShort`).
- Loading row: spinner only if fetch exceeds **200 ms** (`ROW_NAV_LOADING_DELAY_MS`).

### 11.5 Column UI

For each column `i`:

- **Header:** column 0 = long date of week start (`formatTodayHubWeekDateLong`); others = `settings.columns[i-1]` or `Column {i+1}`.
- **Body:** `VaultReadonlyMarkdownBlock` with `noteUri` = synthetic row URI (`todayHubRowUriFromTodayNoteUri`) for relative link resolution context.
- Column 0 header trailing: **week progress strip** (`TodayWeekProgressStrip`) — 7 segments (or 6 with merged weekend when Sat/Sun adjacent); filled/current/empty from `todayHubWeekProgress(weekStart, now)`.

### 11.6 Empty states

- No hubs after index ready: *"Open search to browse notes in this vault."*
- Awaiting first index: spinner + *"Loading vault…"*
- Hub intro load error: show error message string.

---

## 12. Vault search (full-text + fuzzy)

Authoritative native detail: [`mobile-vault-search.md`](../architecture/mobile-vault-search.md). Summary for rebuild:

### 12.1 Product rules

- **No full vault scan on cold app start** before first paint.
- Index warms after vault session exists (`runVaultSearchIndexMaintenance` post-interactions + on search screen open).
- **Foreground:** AppState active + 5-minute interval reconcile.
- **Background:** periodic WorkManager reconcile (optional but reference has it).

### 12.2 Index (SQLite FTS5)

- **Eligible files:** all vault `.md` passing `isEligibleVaultMarkdownFileName` and visibility rules (recursive walk under SAF root).
- **FTS5 columns:** `uri` (unindexed), `rel_path`, `title`, `filename`, `body`; tokenizer `unicode61 remove_diacritics 2`.
- **Phases:** titles first (`body=''`), then bodies; `indexReady` when titles complete; `bodiesIndexReady` when all bodies filled/skipped.
- **Incremental rebuild** retains DB file; schema version mismatch → rebuild.
- **Reconcile** diff by `(size, lastModified)`; touch paths on inbox create/write/delete.

Index path pattern: app files dir `vault-search-index/{sha1(canonicalBaseUri)}.sqlite`.

### 12.3 Query UX

- Debounce **260 ms** default.
- Cancel prior search on new query.
- Hold previous results **100 ms** when query changes (avoid flicker).
- Status lines: *Opening search index…*, *Searching…*, *N notes found*, partial body index footer hint.
- Empty query hint: *"Type to search markdown in the vault."*
- No matches: *"No matches."* (when index ready).

### 12.4 FTS query building (`Fts5Query`)

- Tokenize on whitespace.
- Each token → double-quoted phrase in MATCH expression; strip `"`, `(`, `)`, `\`; drop operator tokens `and|or|not|near`.
- Implicit **AND** between tokens.

### 12.5 Ranking (`SearchRanker`)

For each FTS candidate (BM25 pre-filter, cap ~100):

| Tier | Score boost | Condition |
| ---- | ----------- | --------- |
| Title/path exact | 40_000 | full query substring in title or rel_path |
| Prefix | 25_000 | token prefix on title/filename/path word segments (token len ≥ 3) |
| Fuzzy title/path | 12_000 | query len ≥ 4; bounded Levenshtein on word segments (max distance 1 if token len ≤5 else 2) |
| Body | 0 + BM25×0.02 | default |

**bestField:** `title` > `path` > `body`. **matchCount:** token hit count across fields (min 1).

**Snippet:** first body line matching full query or any token (len ≥ 3); max 160 chars; 1-based line number.

**Result caps:** initial event top **50**; final top **150**. Sort for UI: `compareVaultSearchNotes` (score desc, bestField rank, uri).

### 12.6 Result row UI

- Title (or path fallback) with query highlight (`vaultSearchHighlightSegments`)
- Relative path (highlighted)
- Optional snippet: `{lineNumber} · {text}` (2 lines max)
- Tap → `VaultNoteReadScreen`

### 12.7 Stale event safety

Every native search event carries `searchId` + `vaultInstanceId`; JS drops mismatches. `vaultInstanceId` rotates on full rebuild / new DB / base URI hash change.

---

## 13. Images in markdown

### 13.1 On-disk format

- Attachments live at vault root: **`Assets/Attachments/{filename}`**.
- From an **`Inbox/note.md`** file, markdown image syntax uses **inbox-relative** paths:

```markdown
![Image](../Assets/Attachments/my-photo-abc123.png)
```

- Allowed extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg` (`ATTACHMENT_IMAGE_EXTENSIONS`).
- Filename pattern when created from desktop paste: `{sanitizedStem}-{uniqueToken}{ext}` (`buildAttachmentFileName`).
- **Transient URLs** (`blob:`, `data:image/…`) must not appear in persisted vault markdown (`markdownContainsTransientImageUrls`).

### 13.2 Read-only rendering behavior

> **Reference behavior (important — this is a known gap, not parity):** The reference app does **not** resolve or render **local** vault attachments. Neither the shared read-only renderer (`NoteContentView`/`VaultReadonlyMarkdownBlock`) nor the inbox detail renderer (`NoteDetailScreen`) installs a custom `image` rule. Markdown image nodes fall through to `react-native-markdown-display`'s default renderer, which sets `source={{ uri }}` to the **raw** `src`. A vault-relative path like `../Assets/Attachments/x.png` is not a loadable SAF/`content://` URI, so it silently fails to load. Only absolute `http(s)://` / `data:` images render today.
>
> The rebuild **should improve on this** by resolving local attachment paths to a loadable URI (below). Treat local-image display as an **explicit enhancement beyond reference parity**, not a behavior to copy. On-disk format parity (§13.1) is unaffected — the rebuild only changes how an already-stored `src` is loaded for display.

Rebuild must implement **URI resolution** before display:

| `src` in markdown | Resolved load URI |
| ----------------- | ----------------- |
| `https://…`, `http://…`, `data:…` | Pass through unchanged |
| `../Assets/Attachments/…` or path containing `Assets/Attachments` | Resolve relative to **directory of the note being rendered**, then to absolute vault file, then to a **loadable URI** (SAF `content://` or `file://` the platform accepts) |
| Other relative paths | Best-effort resolve from note directory; if not an image under vault, show broken/placeholder |

**Algorithm (equivalent to desktop `resolveVaultImagePreviewUrl`):**

1. Determine **note base directory** = dirname of current note URI (for Today row cells, use row URI; for Inbox detail if ever extended, use inbox note URI).
2. If `src` is vault-relative attachment path, `posixResolve` from note base → vault absolute path.
3. Map absolute vault path → platform media URI readable by `Image`.

**Display constraints:**

- Scale images to screen width; preserve aspect ratio.
- Alt text used for accessibility label when present.
- SVG: render only if platform supports it; otherwise optional placeholder.

### 13.3 Scope note (reference app)

The reference Android app does **not** implement inbox **paste-to-attachment** (desktop does). Rebuild inherits **read** behavior for images already stored in vault markdown. Creating images in inbox compose is out of scope unless explicitly added later.

---

## 14. Caching and side effects (inbox mutations)

On every successful **create / write / delete** of an inbox note:

1. Update `inboxContentByUri` cache (write/create) or prune (delete).
2. `touchVaultSearchNoteUris(baseUri, [uris])` — async, non-blocking.
3. `touchMarkdownNoteUris(baseUri, [uris])` — update wiki index registry.
4. Schedule debounced vault markdown refs refresh (UI wiki index).
5. Refresh inbox list (silent after create/delete).

`read(noteUri)` checks inbox cache, then Today hub cache, then SAF.

---

## 15. Acceptance tests (minimum)

Rebuild should pass equivalent scenarios (automated where possible):

### Inbox

- Create note title-only → file `# Title\n`, list shows H1 title, filename stem sanitized.
- Create with body → H1 + blank line + body.
- Edit preserves URI; compose round-trip via `inboxMarkdownFileToComposeInput`.
- Duplicate titles → `-2`, `-3` suffix filenames.
- Multi-select delete removes files; reject delete when URI stale.
- List sort by mtime desc.

### Read-only / wiki

- `[[Note]]` opens indexed note; `[[Note|Alias]]` shows Alias.
- Ambiguous stems → picker with ≥2 candidates.
- `[[https://x.com]]` opens browser.
- `[text](../Inbox/other.md)` and wiki path variants resolve.
- Wiki outside code fence; inside fence unchanged.
- Unresolved link muted (or internal color while loading).

### Today Hub

- Parse frontmatter columns; split row on `::today-section::`.
- Week nav skips missing stems; subtitle updates.
- Intro + columns render markdown including wiki links to other notes.

### Search

- Token AND search; quote-safe FTS strings.
- Title match ranks above body-only match.
- Fuzzy prefix on filename (≥4 chars query).
- Debounce + cancel behavior.
- touchPaths after inbox edit updates index without full rebuild.

### Images

- `![](https://…)` displays remotely (**parity** — reference already does this).
- `![](../Assets/Attachments/x.png)` in a vault/Inbox note displays when the file exists (**enhancement beyond reference** — see §13.2; reference fails to load this).

Use `@eskerra/core` unit tests as golden vectors where applicable (`inboxComposeNote.test.ts`, `todayHub.test.ts`, `wikiLinkInbox.test.ts`, `vaultSearchHighlight.test.ts`, `attachmentPaths.test.ts`).

---

## 16. Explicit non-goals

- iOS / cross-mobile portability
- Inbox rich editor (CodeMirror-style); plain text compose only
- Note rename/move outside compose filename rules
- Editing Today Hub row files or `Today.md` on mobile (read-only)
- Desktop-style image paste on compose
- Full-text fuzzy match **inside body** beyond FTS5 + BM25 (no Levenshtein on body text in v1)
- Real-time SAF file observer (reconcile/timer-driven index only)
- Light mode theming

---

## 17. Reference file index

| Concern | Primary paths |
| ------- | ------------- |
| Inbox list | `apps/mobile/src/features/inbox/screens/InboxScreen.tsx` |
| Inbox detail | `apps/mobile/src/features/vault/screens/NoteDetailScreen.tsx` |
| Compose | `apps/mobile/src/features/vault/screens/AddNoteScreen.tsx`, `packages/eskerra-core/src/inboxComposeNote.ts` |
| Storage | `apps/mobile/src/core/storage/eskerraStorage.ts` |
| Notes API | `apps/mobile/src/core/vault/NotesContext.tsx` |
| Vault read | `apps/mobile/src/features/vault/components/NoteContentView.tsx`, `VaultReadonlyMarkdownBlock.tsx` |
| Wiki rules | `apps/mobile/src/features/vault/markdown/vaultReadonlyMarkdownRules.tsx`, `vaultWikiLinkPreprocess.ts` |
| Today UI | `apps/mobile/src/features/vault/screens/VaultScreen.tsx`, `VaultTodayHubWorkArea.tsx`, `VaultTodayHubContext.tsx` |
| Search UI | `apps/mobile/src/features/vault/screens/VaultSearchScreen.tsx`, `useVaultContentSearch.ts` |
| Search native | `apps/mobile/android/.../vaultsearch/VaultSearchModule.kt`, `SearchRanker.kt`, `Fts5Query.kt` |
| Search spec | `specs/architecture/mobile-vault-search.md` |
| Attachments contract | `packages/eskerra-core/src/attachments/*`, `specs/architecture/desktop-editor.md` (§ Attachments) |

---

*Last aligned with repository behavior as of the Eskerra Android app in `apps/mobile/` (Today tab, inbox I/O, vault search, read-only markdown). Update this plan when those behaviors change.*
