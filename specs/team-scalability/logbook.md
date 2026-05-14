# Team Scalability Logbook

Chronological record of the team-scalability loop defined in [`README.md`](./README.md). Append-only: newer entries on top, older entries below.

Three entry types:

- **Baseline** — opens a cycle. Captures the metrics we will measure against.
- **PR** — one row per extraction PR. Records what was extracted, before/after numbers, and links to the diff.
- **Review** — one row per second-model review. Records reviewer findings and how they were resolved.
- **Reassessment** — closes a cycle (typically day 14). Records the decision for the next cycle.

## Entry templates

Copy the relevant block at the top of the log when starting a new entry.

### Baseline entry template

```markdown
## Baseline — YYYY-MM-DD — cycle N

**Branch:** `<branch>`
**Commit:** `<short-sha>`

Snapshot of the metrics this cycle will move:

- `useMainWindowWorkspace.ts` LOC: <number>
- Workspace-related sibling hooks LOC sum: <number>
- `react-hooks/exhaustive-deps` warnings in workspace hook: <number>
- ESLint suppression count (output of `npm run check:eslint-suppressions`): <number>
- Test file count under `apps/desktop/src/`: <number>
- `src/lib/` root-level file count: <number>
- `npm run check:architecture` status: pass | fail

Candidates considered for extraction this cycle:

- <candidate-1> — <one-line rationale> — risk: low | medium | high
- <candidate-2> — ...
- <candidate-3> — ...

Selected candidate: <candidate-name>

Reason for selection: <one or two sentences, including why it is outside the danger zones>
```

### PR entry template

```markdown
## PR — YYYY-MM-DD — #<pr-number> — <short title>

**Cycle:** N
**Type:** pure refactor | behavior change | docs-only
**Author session:** <model + session note, e.g. "opus 4.7 medium">

**What moved**

- From: `<source file>`
- To: `<new file or files>`
- LOC delta source: <before> -> <after> (<delta>)
- LOC new module(s): <number> each
- Tests added: <list>

**Module budget**

- Baseline entries changed: <list of paths>
- Direction: down only? yes | no
- New file respects NEW_FILE_MAX_LINES (400)? yes | no

**Behavior**

- Behavior change: yes | no
- If yes, link to spec or design note: <link>

**Verification**

- `npm run lint`: pass | fail
- `npm test` (relevant workspace): pass | fail
- `npm run check:architecture`: pass | fail
- Manual smoke test: <one line of what was tried>

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? yes | no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? yes | no
- If any yes: STOP and document why this PR is being attempted.

**Notes**

<free-form, optional>
```

### Review entry template

```markdown
## Review — YYYY-MM-DD — #<pr-number>

**Reviewer session:** <model + session note>
**Reviewer prompt used:** <link or inline>

**Prompt template for reusing this review:**

> You are reviewing a refactor PR for the Eskerra desktop app. Read:
> 1. The PR diff at <link>.
> 2. The original file before the refactor: <path>.
> 3. The new extracted file(s): <paths>.
> 4. `specs/team-scalability/README.md` (especially the danger-zone section).
> 5. The relevant section of `CLAUDE.md`.
>
> Report:
> - Any closure / ref / dependency that was silently dropped or rebound.
> - Any state-mutation path in the original that is not preserved in the new code.
> - Any missing test that the original behavior implicitly depended on.
> - Whether the module-budget baseline was lowered correctly.
> - Whether any danger-zone file was touched.
>
> Be specific. Cite line numbers. Do not approve or reject — just list findings.

**Findings (verbatim from reviewer):**

1. <finding>
2. <finding>
3. ...

**Resolutions:**

- Finding 1: <addressed in commit <sha> | follow-up PR #<n> | won't fix because ...>
- Finding 2: ...
```

### Reassessment entry template

```markdown
## Reassessment — YYYY-MM-DD — end of cycle N

**Cycle window:** <start date> -> <end date>
**PRs merged this cycle:** <list with numbers>

**Metric movement vs. baseline:**

- `useMainWindowWorkspace.ts` LOC: <before> -> <after>
- Workspace sibling hooks LOC sum: <before> -> <after>
- Module-budget baseline entries lowered: <count>
- New ESLint suppressions: <count, target 0>
- Danger-zone touches: <count, target 0>

**Exit-criteria check (from README):**

1. 2-3 small extractions merged? yes | no
2. Every PR has a logbook PR entry? yes | no
3. Every PR has a logbook review entry? yes | no
4. Baseline only moved down? yes | no
5. No danger-zone files modified? yes | no
6. No new ESLint suppressions, `check:architecture` green? yes | no

**What went well:** <2-4 bullets>

**What was harder than expected:** <2-4 bullets>

**Decision for next cycle:** continue same loop | adjust cadence | pause | escalate to phase 2

**Reasoning:** <one paragraph>
```

---

## PR — 2026-05-14 — hasReopenableClosedEditorTab extraction

**Cycle:** cleaning-things-up-pt-7
**Type:** pure refactor
**Author session:** sonnet 4.6 medium

**What moved**

- From: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (`canReopenClosedEditorTab` useMemo body, lines ~680-698)
- To: `apps/desktop/src/lib/editorClosedTabStack.ts` (new `hasReopenableClosedEditorTab` export)
- LOC delta source: 4087 → 4076 (−11)
- LOC new function: ~20 lines added to `editorClosedTabStack.ts` (101 → 121)
- Tests added: 7 new tests in `editorClosedTabStack.test.ts` covering null vaultRoot, empty stack, top-entry reopenable, non-top-entry reopenable, all-stale, note-set membership, and no-mutation guarantee (10 → 17 total tests)

**Module budget**

- Baseline entries changed: `useMainWindowWorkspace.ts` (4087 cap → now 4074, cap still 4088)
- Direction: down only? yes
- New function respects NEW_FILE_MAX_LINES: n/a — added to existing file; file is 121 lines

**Behavior**

- Behavior change: no
- `isEditorClosedTabReopenable` removed from the hook's direct import (delegated via `hasReopenableClosedEditorTab`)

**Verification**

- `npm run lint`: pass
- `npx vitest run apps/desktop/src/lib/editorClosedTabStack.test.ts` (17 tests): pass
- `npm run check:architecture`: pass
- Manual smoke test: not run — pure derivation with no side effects

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

Anti-growth cap not raised (remains 4088). The useMemo now delegates all scan logic to the helper; the hook only builds the `noteSet` from React state and passes plain values. No closures, refs, or deps changed.

---

## Audit — 2026-05-14 — useMainWindowWorkspace anti-growth policy and next candidates

**Scope:** docs-only audit; no application code, refactor, file move, or module-budget change.

**Files read**

- `specs/team-scalability/current-status.md`
- `specs/team-scalability/logbook.md`
- `apps/desktop/src/hooks/useMainWindowWorkspace.ts`
- nearby `workspace*.ts` hooks/helpers
- `scripts/check-module-budgets.mjs`
- `scripts/module-budget-baseline.json`

**Anti-growth policy added**

Recorded in `specs/team-scalability/useMainWindowWorkspace-candidates.md`:

- `useMainWindowWorkspace.ts` must not grow above the current module-budget cap (`4088` script-counted lines; `wc -l` currently reports `4087`).
- New behavior should land in focused helpers, hooks, or modules first.
- The main hook should only wire dependencies, own React orchestration, and delegate focused logic.
- Raising the budget requires an explicit logbook note, a reason, and a temporary follow-up plan to lower it again.
- Prefer one small extraction per cleanup cycle.

**Candidates audited**

Detailed notes are in `specs/team-scalability/useMainWindowWorkspace-candidates.md`.

- `hasReopenableClosedEditorTab` — source lines ~679-698; derives the closed-tab reopen enabled state; danger-zone proximity low; testability high; likely files: `editorClosedTabStack.ts`, `editorClosedTabStack.test.ts`, `useMainWindowWorkspace.ts`; risk: low; **safe now**.
- `resolveModelBackedLegacyTabStrip` — source lines ~1485-1500 and ~2069-2086; chooses model-derived tabs only when signatures match legacy output; danger-zone proximity low to medium; testability high; likely files: `workspaceRuntimeProjection.ts` or `workspaceRuntimeTabsLegacyBridge.ts`, test file, `useMainWindowWorkspace.ts`; risk: medium; **later**.
- `useWorkspaceVaultMarkdownRefs` — source lines ~2463-2489; owns async markdown-ref collection and stale-result suppression; danger-zone proximity medium because refresh nonces intersect vault mutation/watch refresh paths; testability medium; likely files: new `workspaceVaultMarkdownRefs.ts`, test file, `useMainWindowWorkspace.ts`; risk: medium; **later**.
- `deriveDefaultActiveTodayHubRestore` — source lines ~3915-3977; chooses/restores the default active Today hub after restore; danger-zone proximity medium due shell restore and Today Hub workspace persistence state; testability high if kept pure; likely files: `workspaceTodayHubDerived.ts` or `workspaceInboxShellRestoreBridge.ts`, test file, `useMainWindowWorkspace.ts`; risk: medium; **later**.
- `normalizeWorkspaceVaultRootPath` — source lines ~257-259 and call sites around ~710, ~3802, ~3919; pure vault-root canonicalization; danger-zone proximity low; testability high; likely files: a small restore/projection helper, test file, `useMainWindowWorkspace.ts`; risk: low; **safe now, but low value**.

**Recommended next extraction**

Recommend only `hasReopenableClosedEditorTab`.

Reason: it is the clearest one-small-extraction target, already belongs with `editorClosedTabStack.ts`, needs only pure unit tests, and avoids `lastPersistedRef`, `inboxContentByUri`, `saveNoteMarkdown`, the autosave scheduler, watcher/reconcile behavior, and editor-save flow. `normalizeWorkspaceVaultRootPath` is also safe but too small to justify a cleanup cycle by itself.

---

## Review — 2026-05-14 — phase 2 vault PR #1 — move pure vault helpers into lib/vault/

**Reviewer session:** sonnet 4.6 — phase-2-vault-pr1 review session
**Review prompt:** Close phase 2 vault PR #1; verdict accept with no findings; confirm file scope, import mechanics, no content changes, no added files or restrictions.

**Files reviewed**

- `apps/desktop/src/lib/vault/vaultBacklinkBodySeed.ts`
- `apps/desktop/src/lib/vault/vaultBacklinkBodySeed.test.ts`
- `apps/desktop/src/lib/vault/countInboxVaultMarkdownRefs.ts`
- `apps/desktop/src/lib/vault/countInboxVaultMarkdownRefs.test.ts`
- 2 updated import call sites (`VaultTab.tsx`, `workspaceBacklinks.ts`)

**Findings**

Blocking: none
Tiny follow-ups: none

**Checklist**

- Only four approved files moved: confirmed — no other files added or removed from `src/lib/` root
- `resolveVaultLinkBaseMarkdownUri.ts` stayed root-level: confirmed
- `vaultBootstrap.ts` not moved: confirmed
- `saveNoteMarkdown` not touched: confirmed
- Watcher planning files not touched: confirmed
- Merge/write paths not touched: confirmed
- Attachment/image persistence files not touched: confirmed
- Imports mechanical: confirmed — only path strings updated; no imports added or removed
- Function bodies unchanged: confirmed — `mergeVaultBacklinkBodySeed` (single spread-merge) and `countInboxVaultMarkdownRefs` (pure counting loop) identical to pre-move
- Constants unchanged: confirmed — no constants, defaults, or persisted values in either file
- Test assertions unchanged: confirmed — all 8 test assertions identical to pre-move
- No `index.ts` or barrel added or changed: confirmed
- No ESLint deep-import restrictions added: confirmed
- No CODEOWNERS, CONTRIBUTING.md, or PR template changes: confirmed
- `src/lib/` root-level file count: confirmed 122 → 118 (−4)
- Targeted tests (8 tests, 2 files): pass
- `npm run check:architecture`: pass

**Verdict:** accept

**Final status:** accepted

---

## Phase 2 vault PR #1 — 2026-05-14 — move pure vault helpers into lib/vault/

**Cycle:** phase 2
**Type:** pure refactor (file move + import update)
**Author session:** sonnet 4.6 — phase-2-vault-pr1 session

**What moved**

- From: `apps/desktop/src/lib/` (root)
- To: `apps/desktop/src/lib/vault/` (new folder)
- Files moved:
  - `vaultBacklinkBodySeed.ts`
  - `vaultBacklinkBodySeed.test.ts`
  - `countInboxVaultMarkdownRefs.ts`
  - `countInboxVaultMarkdownRefs.test.ts`
- `apps/desktop/src/lib/` root-level file count: 122 → 118 (−4)
- Import call sites updated: 2
  - `apps/desktop/src/components/VaultTab.tsx` (1 import: `countInboxVaultMarkdownRefs`)
  - `apps/desktop/src/hooks/workspaceBacklinks.ts` (1 import: `vaultBacklinkBodySeed`)
- Internal imports inside moved source files: none required — both import only from `@eskerra/core`; no relative cross-file references
- Test sibling imports (`./vaultBacklinkBodySeed`, `./countInboxVaultMarkdownRefs`) unchanged as co-located siblings in `vault/`

**Module budget**

- Baseline entries changed: none (moved files were not in the budget baseline JSON)
- Direction: down only? n/a — domain-clustering move, no extractions
- No barrel file (`index.ts`) added or changed
- No ESLint deep-import restrictions added

**Behavior**

- Behavior change: no
- `resolveVaultLinkBaseMarkdownUri.ts` stayed root-level: confirmed
- `vaultBootstrap.ts`, save, watcher, merge/write, and attachment/image persistence files not touched: confirmed
- No editor paste, editor state, attachment persistence, or vault persistence behavior changed

**Verification**

- `npm run lint`: pass
- `npm run check:architecture`: pass
- `npx vitest run` (2 moved test files, 8 tests): pass
- Manual smoke test: not run — import-only move; no logic changes

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

No `index.ts` added. No ESLint deep-import restrictions added. Both source files were pure (`vaultBacklinkBodySeed.ts` is a single spread-merge; `countInboxVaultMarkdownRefs.ts` is pure counting with no side effects). Direct updated paths used for both call sites.

---

## Phase 2 vault PR #1 prep — 2026-05-14 — tiny pure-helper vault move

**Branch:** `cleaning-things-up-pt-5`

**Baseline**

- `apps/desktop/src/lib/` root-level file count: 122
- Proposed target folder: `apps/desktop/src/lib/vault/`
- `npm run check:architecture` before move: pass (from phase 2 PR #3)

**Exact files to move**

- `apps/desktop/src/lib/vaultBacklinkBodySeed.ts`
- `apps/desktop/src/lib/vaultBacklinkBodySeed.test.ts`
- `apps/desktop/src/lib/countInboxVaultMarkdownRefs.ts`
- `apps/desktop/src/lib/countInboxVaultMarkdownRefs.test.ts`

**Files explicitly excluded**

- `resolveVaultLinkBaseMarkdownUri.ts`: no exact tests; defer until tests exist or a separate prep entry accepts moving an untested pure helper.
- All vault tree helpers, watcher helpers, merge/write helpers, attachment/image persistence files, and `vaultBootstrap.ts`: excluded per the vault domain audit.

**Import call sites needing mechanical updates**

- `apps/desktop/src/components/VaultTab.tsx` imports `../lib/countInboxVaultMarkdownRefs`
- `apps/desktop/src/hooks/workspaceBacklinks.ts` imports `../lib/vaultBacklinkBodySeed`
- Moved tests import sibling modules via `./vaultBacklinkBodySeed` and `./countInboxVaultMarkdownRefs`; these remain sibling imports after the move.
- Internal imports inside moved source files: none — both import only from `@eskerra/core`; no relative cross-file references.

**Targeted tests for the move PR**

- `npx vitest run src/lib/vault/vaultBacklinkBodySeed.test.ts src/lib/vault/countInboxVaultMarkdownRefs.test.ts`
- `npm run check:architecture`
- `npm run lint`

**Non-goals**

- No behavior changes.
- Do not move `resolveVaultLinkBaseMarkdownUri.ts`.
- Do not move vault tree, watcher, merge/write, attachment/image, or bootstrap files.
- No barrel or `index.ts`.
- No deep-import ESLint restrictions.
- No `.git-blame-ignore-revs` change until after the move commit exists.
- No module-budget update.

## Planning — 2026-05-14 — phase 2 vault domain audit

Created `specs/team-scalability/phase-2-vault-domain-audit.md` as a documentation-only audit for a future `vault/` migration. The safest first vault PR, if the team continues, is limited to the tested pure helpers `vaultBacklinkBodySeed.*` and `countInboxVaultMarkdownRefs.*`; `vaultBootstrap.ts`, `saveNoteMarkdown`, watcher planning, merge/write paths, and attachment/image persistence remain paused pending separate high-effort prep.

## Reassessment — 2026-05-14 — phase 2 domain clustering after PR #3

**Phase 2 window:** 2026-05-14 to 2026-05-14
**PRs completed:** PR #1 `layout/`; PR #2 `todayHub/`; PR #3 `clipboard/`

**Metric movement**

- `apps/desktop/src/lib/` root-level file count: 142 -> 122
- Domains created/filled: `layout/`, `todayHub/`, `clipboard/`
- Files moved: 20 total
- Behavior changes: 0
- Danger-zone touches: 0
- Barrels/index files added: 0
- ESLint deep-import restrictions added: 0

**What went well:** Prep entries with exact file lists and import call sites continued to work. The `clipboard/` move proved a medium-risk domain can still be moved safely when the scope is narrow, tests are colocated, and review checks body/constant/test equivalence instead of assuming import churn is harmless.

**What was harder than expected:** `clipboard/` needed sharper boundaries than the first two moves. It was movable only because prep separated clipboard helpers from attachment persistence, vault preview, and storage files. The move also surfaced an extra test-harness import in `vitest.setup.ts`, which reinforces that prep audits should include test setup and reset hooks for modules with singletons.

**Process lessons:** File-move reviews must keep checking function bodies, constants, defaults, persisted values, and test assertions. Manual/editor smoke-test expectations should be recorded explicitly for UI-adjacent moves, even when the final PR is import-only. Remaining domains are heavier and should not be started casually: `vault/`, `editor/`, `gitSync/`, `workspaceModel/`, and `tauri/`.

**Decision:** pause phase 2 after three successful moves.

**Reasoning:** Phase 2 has now reduced the flat `src/lib/` root by 20 files without behavior changes or new boundary restrictions. The remaining candidate groups are materially higher risk and need a fresh high-effort audit before any move. Do not add contributor-process docs yet unless the next PR will involve another human contributor, and do not return to phase 1 hook extraction without a separate fresh audit.

## Review — 2026-05-14 — phase 2 PR #3 — move clipboard helpers into lib/clipboard/

**Reviewer session:** sonnet 4.6 — phase-2-pr3 review session
**Review prompt:** Close phase 2 PR #3; verdict accept with no findings; confirm file scope, import mechanics, no content changes, no added files or restrictions.

**Files reviewed**

- `apps/desktop/src/lib/clipboard/clipboardImageFiles.ts`
- `apps/desktop/src/lib/clipboard/clipboardImageFiles.test.ts`
- `apps/desktop/src/lib/clipboard/clipboardImagePng.ts`
- `apps/desktop/src/lib/clipboard/clipboardImagePng.test.ts`
- `apps/desktop/src/lib/clipboard/htmlClipboardToMarkdown.ts`
- `apps/desktop/src/lib/clipboard/htmlClipboardToMarkdown.test.ts`
- `apps/desktop/src/lib/clipboard/formatVaultImageMarkdown.ts`
- `apps/desktop/src/lib/clipboard/formatVaultImageMarkdown.test.ts`
- 5 updated import call sites (`NoteMarkdownEditor.tsx`, `noteMarkdownCellEditor.ts`, `noteInboxAttachmentHost.ts`, `persistTransientMarkdownImages.ts`, `vitest.setup.ts`)

**Findings**

Blocking: none
Tiny follow-ups: none

**Checklist**

- Only eight approved clipboard files moved: confirmed — no other files added or removed from `src/lib/` root
- Attachment persistence files left untouched: confirmed — `noteInboxAttachmentHost.ts`, `persistTransientMarkdownImages.ts`, and `desktopVaultAttachments.ts` were not moved; only their import paths updated mechanically
- Vault preview file left untouched: confirmed — `resolveVaultImagePreviewUrl.ts` was not moved
- Table-editor clipboard file left untouched: confirmed — `eskerraTableClipboard.ts` was not moved
- Imports mechanical: confirmed — only path strings updated; no imports added or removed
- Function bodies unchanged: confirmed — all helpers (`clipboardDataProbablyHasVaultImage`, `htmlClipboardToMarkdown`, `tryClipboardHtmlToMarkdownInsert`, `formatVaultImageMarkdownForInsert`, `rgbaOrRgbToImageDataPixels`, `rgbaImageToPngBytes`, etc.) identical to pre-move
- Constants unchanged: confirmed — `CLIPBOARD_HTML_MAX_CHARS`, `VAULT_IMAGE_MARKDOWN_ALT`, `STRUCTURAL_HTML_MARKERS`, and singleton `turndownSingleton` all identical
- Test assertions unchanged: confirmed — all 43 test assertions identical to pre-move
- Editor paste behavior unchanged: confirmed — no logic in `NoteMarkdownEditor.tsx` or `noteMarkdownCellEditor.ts` changed; only import path strings updated
- Editor state unchanged: confirmed — no state mutations, refs, hooks, or callbacks changed
- Attachment persistence behavior unchanged: confirmed — `noteInboxAttachmentHost.ts` and `persistTransientMarkdownImages.ts` bodies untouched
- Vault persistence behavior unchanged: confirmed — no vault write paths touched
- No `index.ts` or barrel added or changed: confirmed
- No ESLint deep-import restrictions added: confirmed
- No CODEOWNERS, CONTRIBUTING.md, or PR template changes: confirmed
- `src/lib/` root-level file count: confirmed 130 → 122 (−8)
- Extra call site (`vitest.setup.ts`) found and updated correctly: confirmed — path-only change; `__resetForTests` reset behavior unchanged

**Verdict:** accept

**Final status:** accepted

---

## Phase 2 PR #3 — 2026-05-14 — move clipboard helpers into lib/clipboard/

**Cycle:** phase 2
**Type:** pure refactor (file move + import update)
**Author session:** sonnet 4.6 — phase-2-pr3 session

**What moved**

- From: `apps/desktop/src/lib/` (root)
- To: `apps/desktop/src/lib/clipboard/` (new folder)
- Files moved:
  - `clipboardImageFiles.ts`
  - `clipboardImageFiles.test.ts`
  - `clipboardImagePng.ts`
  - `clipboardImagePng.test.ts`
  - `htmlClipboardToMarkdown.ts`
  - `htmlClipboardToMarkdown.test.ts`
  - `formatVaultImageMarkdown.ts`
  - `formatVaultImageMarkdown.test.ts`
- `apps/desktop/src/lib/` root-level file count: 130 → 122 (−8)
- Import call sites updated: 5
  - `apps/desktop/src/editor/noteEditor/NoteMarkdownEditor.tsx` (3 imports: `clipboardImageFiles`, `formatVaultImageMarkdown`, `htmlClipboardToMarkdown`)
  - `apps/desktop/src/editor/noteEditor/noteMarkdownCellEditor.ts` (3 imports: `clipboardImageFiles`, `formatVaultImageMarkdown`, `htmlClipboardToMarkdown`)
  - `apps/desktop/src/lib/noteInboxAttachmentHost.ts` (2 imports: `clipboardImageFiles`, `clipboardImagePng`)
  - `apps/desktop/src/lib/persistTransientMarkdownImages.ts` (1 import: `clipboardImageFiles`)
  - `apps/desktop/vitest.setup.ts` (1 import: `htmlClipboardToMarkdown` — not in prep entry; discovered during move)
- Internal imports inside moved files: none required (all source files import only from `@eskerra/core`, `@tauri-apps/api/image`, `turndown`, `turndown-plugin-gfm` — no relative cross-file references)
- Test sibling imports (`./clipboardImageFiles`, `./clipboardImagePng`, `./htmlClipboardToMarkdown`, `./formatVaultImageMarkdown`) unchanged as co-located siblings in `clipboard/`

**Module budget**

- Baseline entries changed: none (moved files were not in the budget baseline JSON)
- Direction: down only? n/a — domain-clustering move, no extractions
- No barrel file (`index.ts`) added or changed
- No ESLint deep-import restrictions added

**Behavior**

- Behavior change: no
- No editor paste refactor
- No attachment persistence changes
- No vault persistence changes
- No editor state changes
- Attachment persistence files (`noteInboxAttachmentHost.ts`, `persistTransientMarkdownImages.ts`, `desktopVaultAttachments.ts`) not moved; only their import paths updated
- Vault preview file (`resolveVaultImagePreviewUrl.ts`) not moved
- Table-editor clipboard file (`eskerraTableClipboard.ts`) not moved

**Verification**

- `npm run lint`: pass
- `npm run check:architecture`: pass
- `npx vitest run` (4 moved test files, 43 tests): pass
- `npx vitest run` (3 call-site adjacent test files, 9 tests): pass
- Manual smoke test: not run — import-only move; no logic changes; manual paste/drop smoke check requires running desktop app, which is out of scope for an import-only PR

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? `NoteMarkdownEditor.tsx` import path updated only; no logic lines touched

**Notes**

The prep entry listed 4 external call sites. A 5th was found during the move: `apps/desktop/vitest.setup.ts` imports `__resetForTests` from `htmlClipboardToMarkdown` for test teardown. The path was updated mechanically. No `index.ts` added. No ESLint deep-import restrictions added.

---

## Phase 2 PR #3 prep — 2026-05-14 — clipboard domain migration

**Branch:** `cleaning-things-up-pt-5`
**Commit:** `4e04c343`

**Baseline**

- `apps/desktop/src/lib/` root-level file count: 130
- Proposed target folder: `apps/desktop/src/lib/clipboard/`
- `npm run check:architecture` before move: pass. Note: `check-module-budgets` reported no merge base and skipped git-based new/growth checks, then exited successfully.

**Exact files to move**

- `apps/desktop/src/lib/clipboardImageFiles.ts`
- `apps/desktop/src/lib/clipboardImageFiles.test.ts`
- `apps/desktop/src/lib/clipboardImagePng.ts`
- `apps/desktop/src/lib/clipboardImagePng.test.ts`
- `apps/desktop/src/lib/htmlClipboardToMarkdown.ts`
- `apps/desktop/src/lib/htmlClipboardToMarkdown.test.ts`
- `apps/desktop/src/lib/formatVaultImageMarkdown.ts`
- `apps/desktop/src/lib/formatVaultImageMarkdown.test.ts`

**Files explicitly excluded**

- `apps/desktop/src/lib/noteInboxAttachmentHost.ts` and test: shell-owned Tauri clipboard/drop adapter; it performs attachment import orchestration and should not move with pure clipboard detection/format helpers.
- `apps/desktop/src/lib/persistTransientMarkdownImages.ts` and test: vault attachment persistence/write path; leave out to avoid changing persistence behavior.
- `apps/desktop/src/lib/desktopVaultAttachments.ts`: Tauri vault attachment save/import boundary.
- `apps/desktop/src/lib/resolveVaultImagePreviewUrl.ts` and test: preview URL resolution, not clipboard ingestion.
- `apps/desktop/src/editor/noteEditor/eskerraTableV1/eskerraTableClipboard.ts` and test: table-editor clipboard parsing, not a root `src/lib/` domain move.

**Import call sites needing mechanical updates**

- `apps/desktop/src/editor/noteEditor/NoteMarkdownEditor.tsx` imports `clipboardImageFiles`, `formatVaultImageMarkdown`, and `htmlClipboardToMarkdown`.
- `apps/desktop/src/editor/noteEditor/noteMarkdownCellEditor.ts` imports `clipboardImageFiles`, `formatVaultImageMarkdown`, and `htmlClipboardToMarkdown`.
- `apps/desktop/src/lib/noteInboxAttachmentHost.ts` imports `clipboardImageFiles` and `clipboardImagePng`.
- `apps/desktop/src/lib/persistTransientMarkdownImages.ts` imports `clipboardImageFiles`.
- Moved tests should keep sibling imports after the move.

**Targeted tests for the move PR**

- `npm run test -w @eskerra/desktop -- clipboardImageFiles.test.ts clipboardImagePng.test.ts htmlClipboardToMarkdown.test.ts formatVaultImageMarkdown.test.ts noteMarkdownCellEditor.test.ts noteInboxAttachmentHost.test.ts persistTransientMarkdownImages.test.ts`
- `npm run check:architecture`
- `npm run lint`

**Manual smoke test needed**

- Paste structured HTML into the main note editor and a table cell; confirm Markdown conversion still happens and URL-only paste still falls through to link handling.
- Paste or drop an image into the editor in the desktop app; confirm the attachment import still inserts the same vault image Markdown and no duplicate/default browser paste appears.

**Risk notes**

- `formatVaultImageMarkdown.ts` stays in scope because it formats the Markdown inserted by clipboard/drop image flows and does not perform vault writes.
- This PR is medium risk because call sites are in editor paste/import paths; the review must compare bodies, constants, defaults, and test assertions and verify call-site path-only changes.

**Non-goals**

- No behavior changes.
- No editor paste refactor.
- No attachment persistence changes.
- No vault persistence changes.
- No editor state changes.
- No barrel or `index.ts` changes.
- No deep-import ESLint restrictions.
- No `.git-blame-ignore-revs` change until after the move commit exists.
- No module-budget update for this planning entry.

## Reassessment — 2026-05-14 — phase 2 domain clustering after PR #2

**Phase 2 window:** 2026-05-14 to 2026-05-14
**PRs completed:** PR #1 `layout/`; PR #2 `todayHub/`

**Metric movement**

- `apps/desktop/src/lib/` root-level file count: 142 -> 130
- Domains created/filled: `layout/` created; `todayHub/` filled with root helpers
- Files moved: 12 total
- Behavior changes: 0
- Danger-zone touches: 0
- Barrels/index files added: 0
- ESLint deep-import restrictions added: 0

**What went well:** Both moves stayed small and reviewable. Prep entries with exact file lists and import call sites made reviews fast and concrete. Existing domain folders were safer first targets than creating broad new domains: `todayHub/` already had a folder and `layout/` had clear file naming and focused call sites.

**What was harder than expected:** Even import-only moves can brush against model or UI boundaries. The Today Hub move touched visible rendering imports and `workspaceModel/persistence.ts`; that was acceptable because it was import-only, but model-adjacent files need strict review. `clipboard/` is plausible next, but editor paste/import behavior makes it a higher-review-cost move than `layout/` or `todayHub/`.

**Process lessons:** File-move reviews must compare bodies, constants, persisted values, defaults, and test assertions; import churn is not harmless by default. Keep avoiding barrel/index changes unless the prep proves they are required. Keep high-risk domains deferred: `vault/`, `editor/`, `gitSync/`, `workspaceModel/`, and `tauri/`. If `clipboard/` becomes the next candidate, require a fresh prep entry and explicit editor paste/import review.

**Decision:** pause phase 2 after two successful moves; keep `clipboard/` as the next candidate only after a fresh prep entry.

**Reasoning:** The first two domain moves proved the migration mechanics and reduced the flat `src/lib/` root meaningfully without behavior changes. Continuing immediately would move into medium-risk territory. Do not add contributor-process docs yet, and do not return to phase 1 hook extraction without a separate fresh audit.

## Checkpoint — 2026-05-14 — phase 2 after PR #2

**Phase 2 results so far:** PR #1 `layout/` accepted; PR #2 `todayHub/` accepted. Both were pure file moves with mechanical import updates, no behavior changes, no barrel/index changes, no ESLint deep-import restrictions, and no contributor-process files.

**Migration mechanics:** proven enough for the initial phase-2 hypothesis. Prep entries with exact file lists, import call sites, targeted tests, and non-goals made both reviews fast and concrete. Root-level `apps/desktop/src/lib/` movement so far: 142 -> 130.

**Process lesson from Today Hub:** existing domain folders make review easier, but visible UI helpers still need strict body/test comparison and explicit callout of cross-domain imports such as `workspaceModel/persistence.ts`. Keeping `todayHub/index.ts` unchanged avoided turning a file move into a boundary-design PR.

**Decision:** stop after two successful phase-2 moves and write a reassessment before selecting another domain.

**Recommended next candidate if phase 2 continues:** `clipboard/` is the only plausible next small domain in the current plan, but it is medium risk because it touches editor paste/import behavior. Avoid `vault/`, `editor/`, `gitSync/`, `workspaceModel/`, and `tauri/` for now.

**Next step:** write a phase-2 reassessment. If the reassessment chooses to continue with `clipboard/`, require a fresh prep entry before implementation.

## Review — 2026-05-14 — phase 2 PR #2 — move Today Hub root helpers into lib/todayHub/

**Reviewer session:** sonnet 4.6 — phase-2-pr2 review session
**Review prompt:** Close phase 2 PR #2; verdict accept with no findings; confirm file scope, import mechanics, no content changes, no added files or restrictions.

**Files reviewed**

- `apps/desktop/src/lib/todayHub/todayHubCellStaticPointer.ts`
- `apps/desktop/src/lib/todayHub/todayHubCellStaticPointer.test.ts`
- `apps/desktop/src/lib/todayHub/todayHubCellStaticView.ts`
- `apps/desktop/src/lib/todayHub/todayHubCellStaticView.test.ts`
- `apps/desktop/src/lib/todayHub/todayHubWorkspaceRestore.ts`
- `apps/desktop/src/lib/todayHub/todayHubWorkspaceRestore.test.ts`
- 5 updated import call sites (`TodayHubCellStaticRichText.tsx`, `TodayHubCanvas.tsx`, `useMainWindowWorkspace.ts`, `inboxShellRestoreHelpers.ts`, `workspaceModel/persistence.ts`)

**Findings**

Blocking: none
Tiny follow-ups: none

**Checklist**

- Only six approved files moved: confirmed — no other files added or removed from `src/lib/` root
- Imports mechanical: confirmed — only path strings updated; no imports added or removed
- Function bodies unchanged: confirmed — all helpers (`pickDefaultActiveTodayHubUri`, `buildTodayHubCellStaticViewModel`, `clipSegmentsToRange`, pointer helpers) identical to pre-move
- Constants unchanged: confirmed — no constants or persisted values changed
- Test assertions unchanged: confirmed — all 20 test assertions identical to pre-move
- `workspaceModel/persistence.ts` changed only its import path: confirmed — no other lines touched
- No Today Hub rendering refactor introduced: confirmed
- No workspace model or editor tab model behavior changed: confirmed
- No `index.ts` or barrel added or changed: confirmed
- No ESLint deep-import restrictions added: confirmed
- No CODEOWNERS, CONTRIBUTING.md, or PR template changes: confirmed
- `src/lib/` root-level file count: confirmed 136 → 130

**Verdict:** accept

**Final status:** accepted

---

## Phase 2 PR #2 — 2026-05-14 — move Today Hub root helpers into lib/todayHub/

**Cycle:** phase 2
**Type:** pure refactor (file move + import update)
**Author session:** sonnet 4.6 — phase-2-pr2 session

**What moved**

- From: `apps/desktop/src/lib/` (root)
- To: `apps/desktop/src/lib/todayHub/` (existing folder)
- Files moved:
  - `todayHubCellStaticPointer.ts`
  - `todayHubCellStaticPointer.test.ts`
  - `todayHubCellStaticView.ts`
  - `todayHubCellStaticView.test.ts`
  - `todayHubWorkspaceRestore.ts`
  - `todayHubWorkspaceRestore.test.ts`
- `apps/desktop/src/lib/` root-level file count: 136 → 130 (−6)
- Import call sites updated: 5
  - `apps/desktop/src/components/TodayHubCellStaticRichText.tsx` (2 imports: `todayHubCellStaticView`, `todayHubCellStaticPointer`)
  - `apps/desktop/src/components/TodayHubCanvas.tsx` (1 import: `todayHubCellStaticPointer`)
  - `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (1 import: `todayHubWorkspaceRestore`)
  - `apps/desktop/src/hooks/inboxShellRestoreHelpers.ts` (1 import: `todayHubWorkspaceRestore`)
  - `apps/desktop/src/lib/workspaceModel/persistence.ts` (1 import: `todayHubWorkspaceRestore`)
- Internal imports inside moved files updated:
  - `todayHubCellStaticView.ts`: `../editor/noteEditor/...` → `../../editor/noteEditor/...` (2 import paths)
  - `todayHubCellStaticView.test.ts`: `../editor/noteEditor/...` → `../../editor/noteEditor/...` (2 import paths)
  - `todayHubWorkspaceRestore.ts`: `./mainWindowUiStore` → `../mainWindowUiStore`
- Test sibling imports (`./todayHubCellStaticPointer`, `./todayHubCellStaticView`, `./todayHubWorkspaceRestore`) remain unchanged as co-located siblings

**Module budget**

- Baseline entries changed: none (moved files were not in the budget baseline JSON)
- Direction: down only? n/a — domain-clustering move, no extractions
- No barrel file (`index.ts`) added or changed
- No ESLint deep-import restrictions added

**Behavior**

- Behavior change: no
- No Today Hub rendering refactor
- No workspace model changes beyond mechanical import path in `workspaceModel/persistence.ts`
- No editor tab model changes

**Verification**

- `npm run test -w @eskerra/desktop -- todayHubCellStaticPointer.test.ts todayHubCellStaticView.test.ts todayHubWorkspaceRestore.test.ts todayHubCanvasCellLayout.test.ts todayHubWarmLru.test.ts`: pass (20 tests, 5 files)
- `npm run lint`: pass
- `npm run check:architecture`: pass
- Manual smoke test: n/a — import-only move; no logic changes

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

No `index.ts` added. No ESLint deep-import restrictions added. Direct updated paths used for all call sites. Existing `todayHub/index.ts` boundary unchanged.

---

## Phase 2 PR #2 prep — 2026-05-14 — Today Hub root helper migration

**Branch:** `cleaning-things-up-pt-4`
**Commit:** `e7002796`

**Baseline**

- `apps/desktop/src/lib/` root-level file count: 136
- Target folder: `apps/desktop/src/lib/todayHub/`
- `npm run check:architecture` before move: pass. Note: `check-module-budgets` reported no merge base and skipped git-based new/growth checks, then exited successfully.

**Exact files to move**

- `apps/desktop/src/lib/todayHubCellStaticPointer.ts`
- `apps/desktop/src/lib/todayHubCellStaticPointer.test.ts`
- `apps/desktop/src/lib/todayHubCellStaticView.ts`
- `apps/desktop/src/lib/todayHubCellStaticView.test.ts`
- `apps/desktop/src/lib/todayHubWorkspaceRestore.ts`
- `apps/desktop/src/lib/todayHubWorkspaceRestore.test.ts`

**Import call sites needing mechanical updates**

- `apps/desktop/src/components/TodayHubCellStaticRichText.tsx` imports `../lib/todayHubCellStaticView` and `../lib/todayHubCellStaticPointer`
- `apps/desktop/src/components/TodayHubCanvas.tsx` imports `../lib/todayHubCellStaticPointer`
- `apps/desktop/src/hooks/useMainWindowWorkspace.ts` imports `../lib/todayHubWorkspaceRestore`
- `apps/desktop/src/hooks/inboxShellRestoreHelpers.ts` imports `../lib/todayHubWorkspaceRestore`
- `apps/desktop/src/lib/workspaceModel/persistence.ts` imports `../todayHubWorkspaceRestore`
- Moved tests currently import sibling modules via `./todayHubCellStaticPointer`, `./todayHubCellStaticView`, and `./todayHubWorkspaceRestore`; these should remain sibling imports after the move.
- Internal imports inside moved files also need path-only updates: `todayHubCellStaticView*` imports from `../editor/...` should become `../../editor/...`; `todayHubWorkspaceRestore.ts` imports `./mainWindowUiStore` and should become `../mainWindowUiStore`.

**Existing tests to run for the move PR**

- `npm run test -w @eskerra/desktop -- todayHubCellStaticPointer.test.ts todayHubCellStaticView.test.ts todayHubWorkspaceRestore.test.ts todayHubCanvasCellLayout.test.ts todayHubWarmLru.test.ts`
- `npm run check:architecture`

**Non-goals**

- No behavior changes.
- No Today Hub rendering refactor.
- No workspace model changes beyond the mechanical import path in `workspaceModel/persistence.ts`.
- No editor tab model changes.
- No barrel or `index.ts` changes unless implementation proves they are required; current audit found no requirement.
- No deep-import ESLint restrictions.
- No `.git-blame-ignore-revs` change until after the move commit exists.
- No module-budget update for this planning entry.

## Checkpoint — 2026-05-14 — phase 2 after PR #1

**Phase 2 PR #1 result:** accepted. The `layout/` move landed as a pure file move plus mechanical import updates: six approved files moved, `windowTiling.ts` stayed root-level, no barrel was added, and `src/lib/` root-level files moved 142 -> 136.

**Migration mechanics:** worked. The prep entry was specific enough to review the diff quickly, and the review found no behavior changes, no assertion changes, no persisted-key/default changes, and no added restrictions or contributor-process files.

**Process lesson:** keep each domain move anchored by a prep entry with exact files, import call sites, targeted tests, and non-goals. For file moves, the review should keep comparing bodies/constants/tests against the pre-move versions rather than treating the diff as harmless import churn.

**Decision:** continue phase 2 with one more small domain move, but require a fresh prep entry before implementation.

**Recommended next candidate:** `todayHub/`. The plan already has an existing `apps/desktop/src/lib/todayHub/` folder, a small set of root files to consider (`todayHubCellStaticPointer*`, `todayHubCellStaticView*`, `todayHubWorkspaceRestore*`), and colocated tests. `clipboard/` remains a plausible later candidate, but it carries editor paste/import risk and should wait until after the Today Hub prep audit. Avoid `vault/`, `editor/`, `gitSync/`, `workspaceModel/`, and `tauri/` for now.

**Next step:** write a Phase 2 PR #2 prep entry before any move. It should confirm the exact Today Hub file list, import call sites, whether the existing `todayHub/index.ts` boundary changes or stays untouched, and targeted tests.

## Review — 2026-05-14 — phase 2 PR #1 — move layout helpers into lib/layout/

**Reviewer session:** sonnet 4.6 — phase-2-pr1 review session
**Review prompt:** Close phase 2 PR #1; verdict accept with no findings; confirm file scope, import mechanics, no content changes, no added files or restrictions.

**Files reviewed**
- `apps/desktop/src/lib/layout/desktopHorizontalSplitClamp.ts`
- `apps/desktop/src/lib/layout/desktopHorizontalSplitClamp.test.ts`
- `apps/desktop/src/lib/layout/desktopVerticalSplitClamp.ts`
- `apps/desktop/src/lib/layout/desktopVerticalSplitClamp.test.ts`
- `apps/desktop/src/lib/layout/layoutStore.ts`
- `apps/desktop/src/lib/layout/layoutStore.test.ts`
- 9 updated import call sites (App.tsx, VaultTabSideColumn.tsx, DesktopHorizontalSplit.tsx, DesktopHorizontalSplitEnd.tsx, DesktopVerticalSplit.tsx, MainWorkspaceSplit.tsx, VaultTab.tsx, useAppLayoutWidthPersisters.ts, useAppOnMountLayoutHydration.ts)

**Findings**

Blocking: none
Tiny follow-ups: none

**Checklist**

- Only six approved files moved: confirmed — no other files added or removed from `src/lib/` root
- `windowTiling.ts` stayed root-level: confirmed
- Imports mechanical: confirmed — only path strings updated; no imports added or removed
- Function bodies unchanged: confirmed — all clamp helpers, sanitizers, migrate/parse functions, load/save functions identical
- Constants unchanged: confirmed — persisted store key names (`layoutPanelsV4`, `layoutPanelsV3`), default values, and clamp constants all identical
- Test assertions unchanged: confirmed — all 20 test assertions identical to pre-move
- No `index.ts` or barrel added: confirmed
- No ESLint deep-import restrictions added: confirmed
- No CODEOWNERS, CONTRIBUTING.md, or PR template changes: confirmed
- `src/lib/` root-level file count: confirmed 142 → 136

**Verdict:** accept

**Final status:** accepted

---

## Phase 2 PR #1 — 2026-05-14 — move layout helpers into lib/layout/

**Cycle:** phase 2
**Type:** pure refactor (file move + import update)
**Author session:** sonnet 4.6 — phase-2-pr1 session

**What moved**

- From: `apps/desktop/src/lib/` (root)
- To: `apps/desktop/src/lib/layout/` (new folder)
- Files moved:
  - `desktopHorizontalSplitClamp.ts`
  - `desktopHorizontalSplitClamp.test.ts`
  - `desktopVerticalSplitClamp.ts`
  - `desktopVerticalSplitClamp.test.ts`
  - `layoutStore.ts`
  - `layoutStore.test.ts`
- `apps/desktop/src/lib/` root-level file count: 142 → 136 (−6)
- Import call sites updated: 9 (App.tsx, VaultTabSideColumn.tsx, DesktopHorizontalSplit.tsx, DesktopHorizontalSplitEnd.tsx, DesktopVerticalSplit.tsx, MainWorkspaceSplit.tsx, VaultTab.tsx, useAppLayoutWidthPersisters.ts, useAppOnMountLayoutHydration.ts)
- Test file sibling imports (3 test files) resolved correctly as co-located siblings in `layout/`

**Module budget**

- Baseline entries changed: none (moved files were not in the budget baseline JSON)
- Direction: down only? n/a — this is a domain-clustering move, no extractions
- `windowTiling.ts` stayed root-level (confirmed)
- No barrel file (`index.ts`) added

**Behavior**

- Behavior change: no
- Persisted layout key names and default values unchanged
- `layoutStore.ts` calls same Tauri store APIs under same conditions
- Clamp constants and return values unchanged

**Verification**

- `npx vitest run` (3 moved test files, 20 tests): pass
- `npm run lint`: pass
- `npm run check:architecture`: pass
- Manual smoke test: n/a — import-only move; no logic changes

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

No `index.ts` or ESLint deep-import restrictions added. Direct updated paths used for all call sites per the plan. `windowTiling.ts` intentionally left root-level (Tauri command glue boundary).

---

## Phase 2 PR #1 prep — 2026-05-14 — layout domain migration

**Branch:** `cleaning-things-up-pt-4`
**Commit:** `92fb2b44`

**Baseline**

- `apps/desktop/src/lib/` root-level file count: 142
- Planned new folder: `apps/desktop/src/lib/layout/`
- `npm run check:architecture` before move: pass. Note: `check-module-budgets` reported no merge base and skipped git-based new/growth checks, then exited successfully.

**Exact files to move**

- `apps/desktop/src/lib/desktopHorizontalSplitClamp.ts`
- `apps/desktop/src/lib/desktopHorizontalSplitClamp.test.ts`
- `apps/desktop/src/lib/desktopVerticalSplitClamp.ts`
- `apps/desktop/src/lib/desktopVerticalSplitClamp.test.ts`
- `apps/desktop/src/lib/layoutStore.ts`
- `apps/desktop/src/lib/layoutStore.test.ts`

**Import call sites needing mechanical updates**

- `apps/desktop/src/App.tsx` imports `./lib/layoutStore`
- `apps/desktop/src/shell/useAppOnMountLayoutHydration.ts` imports `../lib/layoutStore`
- `apps/desktop/src/shell/useAppLayoutWidthPersisters.ts` imports `../lib/layoutStore`
- `apps/desktop/src/components/MainWorkspaceSplit.tsx` imports `../lib/layoutStore`
- `apps/desktop/src/components/VaultTabSideColumn.tsx` imports `../lib/layoutStore`
- `apps/desktop/src/components/VaultTab.tsx` imports `../lib/layoutStore`
- `apps/desktop/src/components/DesktopHorizontalSplit.tsx` imports `../lib/desktopHorizontalSplitClamp` and `../lib/layoutStore`
- `apps/desktop/src/components/DesktopHorizontalSplitEnd.tsx` imports `../lib/desktopHorizontalSplitClamp`
- `apps/desktop/src/components/DesktopVerticalSplit.tsx` imports `../lib/desktopVerticalSplitClamp` and `../lib/layoutStore`
- Moved tests currently import sibling modules via `./desktopHorizontalSplitClamp`, `./desktopVerticalSplitClamp`, and `./layoutStore`; these should remain sibling imports after the move.

**Targeted tests for the move PR**

- `npm run test -w @eskerra/desktop -- desktopHorizontalSplitClamp.test.ts desktopVerticalSplitClamp.test.ts layoutStore.test.ts`
- `npm run check:architecture`

**Non-goals**

- Do not move `windowTiling.ts`.
- No behavior changes.
- No barrel or `index.ts` yet unless implementation proves it is required.
- No deep-import ESLint restrictions.
- No `.git-blame-ignore-revs` change until after the move commit exists.
- No module-budget update for this planning entry.

## Planning — 2026-05-14 — phase 2 lib domain clustering

Created [`phase-2-lib-domain-plan.md`](./phase-2-lib-domain-plan.md) to audit `apps/desktop/src/lib/` root-level files, proposed domain folders, cross-domain risks, and the recommended first migration PR. Decision captured there: start phase 2 with a small `layout/` move and keep higher-risk vault, editor, git sync, workspace model, and Tauri boundaries for later audited PRs.

## Reassessment — 2026-05-14 — end of cycle 2

**Cycle window:** 2026-05-14 -> 2026-05-14
**PRs completed this cycle:** #TBD `collectShadowDivergenceDevDiagnostics`

**Metric movement vs. baseline**

- `useMainWindowWorkspace.ts` LOC: 4099 -> 4087
- Workspace sibling hooks LOC sum: 4902 -> 4951 (expected increase from moving diagnostic logic into `workspacePersistenceBridge.ts`)
- Module-budget baseline entries lowered: 1 (`useMainWindowWorkspace.ts` 4100 -> 4088)
- New ESLint suppressions: 0 (raw `eslint-disable` count remains 13)
- Danger-zone touches: 0
- Test file count under `apps/desktop/src/`: 178 -> 179 (`workspacePersistenceBridge.test.ts` added)

**Exit-criteria check (from README)**

1. 2-3 small extractions merged? no — one completed in cycle 2; stopping early was intentional because no remaining pre-audited candidate was available.
2. Every PR has a logbook PR entry? yes.
3. Every PR has a logbook review entry? yes.
4. Baseline only moved down? yes.
5. No danger-zone files modified? yes.
6. No new ESLint suppressions, `check:architecture` green? yes, based on PR entry.

**What went well:** Candidate B was persistence-diagnostics-adjacent but stayed safe because the helper remained read-only and `console.warn` stayed in the hook. The review confirmed warning ownership, suppress conditions, pending-projection filtering, and exact `{suppress, diffs}` tests. Across cycle 1 and cycle 2, `useMainWindowWorkspace.ts` moved from 4118 -> 4087 LOC.

**What was harder than expected:** The loop is working, but the LOC reduction is still modest relative to the hook size. Cycle 2 also consumed the only carried-forward audited candidate; starting another extraction now would require a fresh audit, not opportunistic guessing.

**Process lessons:** Keep persistence-adjacent extractions read-only unless a separate spec explicitly permits writes. Preserve warning side effects at the caller unless the review scope includes behavior changes. Exact-value tests remain the right default. Future gains need either a fresh phase-1 audit of `useMainWindowWorkspace.ts` or a separate phase-2 `src/lib/` domain plan.

**Decision for next cycle:** pause phase 1 and prepare phase 2 (`src/lib/` domain clustering) as a separate planning cycle.

**Reasoning:** There is no obvious low-risk phase-1 candidate left from the current audit. Continuing phase 1 would be valid only after a new audit, but the first two cycles already proved the extraction process and lowered the hook without touching danger zones. The better next move is to pause hook extractions, write a focused phase-2 plan for `apps/desktop/src/lib/` clustering, and keep contributor-process files (`CODEOWNERS`, `CONTRIBUTING.md`, PR template) out of scope until the directory plan is clearer.

---

## Checkpoint — 2026-05-14 — cycle 2 after PR #1

**Decision:** stop cycle 2 after one successful extraction and write the reassessment next. Do not start another extraction in this cycle.

**Rationale:** Cycle 2 already moved the primary hotspot in the right direction (`useMainWindowWorkspace.ts` 4099 → 4087; budget cap 4100 → 4088), and the persistence-diagnostics-adjacent extraction reviewed cleanly: no writes, warning ownership stayed in the hook, and suppression behavior has exact tests. Candidate B was the only carried-forward audited candidate from cycle 1. Starting another PR now would require a fresh audit, which should happen deliberately in the next cycle rather than inventing a candidate midstream. This is also a good pause point before deciding whether the loop should continue with more phase-1 hook extractions or start planning phase 2 separately.

---

## Review — 2026-05-14 — cycle 2 PR #1 — extract collectShadowDivergenceDevDiagnostics

**Reviewer session:** sonnet 4.6 — cycle-2 review session
**Review prompt:** Close cycle 2 PR #1; verdict accept with no findings; confirm danger-zone, suppression behavior, warning ownership, and test exactness.

**Files reviewed**
- `apps/desktop/src/hooks/workspacePersistenceBridge.ts`
- `apps/desktop/src/hooks/workspacePersistenceBridge.test.ts`
- `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (call site only)

**Findings**

Blocking: none
Tiny follow-ups: none

**Checklist**

- `console.warn` ownership: confirmed — hook retains ownership; helper returns `{diffs, suppress}` and never calls `console.warn` directly
- Danger-zone paths: confirmed not touched — no writes to `lastPersistedRef`, `inboxContentByUri`, or `saveNoteMarkdown`; the extracted `useEffect` body was read-only diagnostic telemetry before and after
- Watcher / cache / persistence / editor-save paths: not touched
- Suppression behavior preserved: confirmed — all three suppress conditions (`!inboxShellRestored`, `!isDevOrTest`, `shadowModelActiveHub === null`) and `hasPendingProjectionHubs` timing-noise filtering carried over exactly
- Tests use exact returned values: confirmed — tests 4–6 assert exact `{suppress, diffs}` shapes including the pending-projection path (`diffs: []` after filter); suppress-path tests assert `{suppress: true, diffs: []}`

**Verdict:** accept

**Final status:** accepted

---

## PR — 2026-05-14 — #TBD — extract collectShadowDivergenceDevDiagnostics

**Cycle:** 2
**Type:** pure refactor
**Author session:** sonnet 4.6 — cycle-2 extraction session

**What moved**

- From: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (body of the dev/test-only `useEffect` that compares model-derived persistence to legacy runtime persistence, lines ~878–919)
- To: `apps/desktop/src/hooks/workspacePersistenceBridge.ts` (new exported function, alongside `describeFilteredLegacyVsModelPersistenceDivergence`)
- LOC delta source: 4099 → 4087 (`wc -l`; script-counted cap lowered from 4100 → 4088)
- LOC helper file: `workspacePersistenceBridge.ts` grew from 32 → 81 (+49)
- Tests added: 6 new unit tests in new `workspacePersistenceBridge.test.ts` (`collectShadowDivergenceDevDiagnostics` describe block)

**Module budget**

- Baseline entries changed: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (4100 → 4088)
- Direction: down only? yes
- Existing helper file `workspacePersistenceBridge.ts` grew from 32 → 81 LOC (+49); not tracked in the baseline JSON (below GROWTH_TRACK_MIN_LINES)
- New test file `workspacePersistenceBridge.test.ts` at 109 LOC respects NEW_FILE_MAX_LINES (400)

**Behavior**

- Behavior change: no
- Warning output (`console.warn('[workspaceModel] persistence legacy divergence', diffs)`) remains owned by the hook. The helper returns `{diffs, suppress}` and never calls `console.warn` directly.
- The `import.meta.env.DEV || import.meta.env.MODE === 'test'` check is lifted out of the helper as `isDevOrTest: boolean` so the helper is testable without Vite env stubs. The hook passes the resolved boolean; behavior is identical.

**Verification**

- `npm run lint`: pass
- `npm test` (relevant workspace — `workspacePersistenceBridge.test.ts`): pass (6 tests)
- `npm run check:architecture`: pass
- Manual smoke test: n/a — dev/test-only diagnostic; no UI surface; useEffect dependency array unchanged

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no (this `useEffect` is read-only diagnostic telemetry; no writes to `lastPersistedRef`, `inboxContentByUri`, or `saveNoteMarkdown`)
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

The extracted helper encapsulates all three suppress conditions (`!inboxShellRestored`, `!isDevOrTest`, `shadowModelActiveHub === null`) and the `hasPendingProjectionHubs` computation, shrinking the `useEffect` body from ~32 lines to ~19 lines. The helper sits alongside `describeFilteredLegacyVsModelPersistenceDivergence` in `workspacePersistenceBridge.ts`, which already owns the divergence comparison logic.

---

## Baseline — 2026-05-14 — cycle 2

**Branch:** `cleaning-things-up-pt-3`
**Commit:** `995233d0`

Measurements:

- `useMainWindowWorkspace.ts` LOC: **4099**
- Workspace-related sibling hooks LOC sum: **4902** (21 files matching `apps/desktop/src/hooks/workspace*.ts`, excluding `*.test.ts`)
- `react-hooks/exhaustive-deps` warnings in `useMainWindowWorkspace.ts`: **0** (`npx eslint` emitted no warnings)
- `eslint-disable` occurrences under `apps/desktop/src/`: **13** (raw lines)
- Test file count under `apps/desktop/src/`: **178** (`*.test.ts` + `*.test.tsx`)
- `apps/desktop/src/lib/` root-level file count: **142** (regular files only, subdirectories excluded)
- `npm run check:architecture` status: **pass** (exit 0)

Commands used:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
wc -l apps/desktop/src/hooks/useMainWindowWorkspace.ts
find apps/desktop/src/hooks -maxdepth 1 -name "workspace*.ts" ! -name "*.test.ts" -print0 | xargs -0 wc -l
cd apps/desktop && npx eslint src/hooks/useMainWindowWorkspace.ts
rg -n "eslint-disable" apps/desktop/src -g "*.ts" -g "*.tsx" | wc -l
find apps/desktop/src -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) | wc -l
find apps/desktop/src/lib -maxdepth 1 -type f | wc -l
npm run check:architecture
```

### Selected candidate for cycle 2 PR #1

**Candidate B — `collectShadowDivergenceDevDiagnostics`.**

Reason: carried forward from cycle 1; low-risk dev/test diagnostic extraction; no persistence writes; requires exact tests around suppression and pending projection hubs.

Caveat: this is persistence-diagnostics-adjacent, so review must be strict about no writes, no cache touches, and warning behavior only.

---

## Reassessment — 2026-05-14 — end of cycle 1

**Cycle window:** 2026-05-14 -> 2026-05-14
**PRs completed this cycle:** #TBD `injectActiveHubIntoTodayHubPersistMap`; #TBD `popNextReopenableClosedTabRecord`

**Metric movement vs. baseline**

- `useMainWindowWorkspace.ts` LOC: 4118 -> 4099
- Workspace sibling hooks LOC sum: 4855 -> 4902 (expected increase from moving logic into sibling helpers)
- Module-budget baseline entries lowered: 1 (`useMainWindowWorkspace.ts` 4119 -> 4100 in PR #1; PR #2 was LOC-neutral and did not need a budget change)
- New ESLint suppressions: 0 (raw `eslint-disable` count remains 13)
- Danger-zone touches: 0
- Test file count under `apps/desktop/src/`: 178 -> 178 (new tests were added to existing colocated test files)

**Exit-criteria check (from README)**

1. 2-3 small extractions merged? yes — two completed.
2. Every PR has a logbook PR entry? yes.
3. Every PR has a logbook review entry? yes.
4. Baseline only moved down? yes — PR #1 lowered the hook cap; PR #2 did not raise or require a cap change.
5. No danger-zone files modified? yes.
6. No new ESLint suppressions, `check:architecture` green? yes, based on PR entries.

**What went well:** Both extractions stayed small and reviewable, and the second-model pass caught useful process details rather than major correctness bugs. PR #1 review caught a weak assertion and imprecise JSDoc before merge. PR #2 kept mutation ownership clear by leaving ref reads, `bumpEditorClosedStack()`, and `openMarkdownInEditor` in the hook.

**What was harder than expected:** The LOC movement was modest: PR #1 lowered the hook, while PR #2 improved ownership and tests without reducing hook LOC. PR #2 also showed that even a “pure refactor” can intentionally coalesce callback calls, so future reviews must check side-effect timing and not only final state.

**Process lessons:** Exact-value tests are preferred over `toBeDefined()` style assertions for these extractions. Review prompts should keep asking about callback timing, mutation count, and dependency assumptions, not just output equivalence. The loop produced enough signal after two PRs; stopping before PR #3 was intentional, not a failure.

**Decision for next cycle:** continue same loop with Candidate B as cycle 2 PR #1.

**Reasoning:** Candidate B (`collectShadowDivergenceDevDiagnostics`) remains low-risk and should carry forward as the first candidate for cycle 2. It is persistence-diagnostics-adjacent, so it deserves the same small-diff discipline and exact tests around suppression behavior and pending projection hubs. There is no concrete reason to pause, and phase 2 should not start yet; the current loop is working as a controlled way to reduce the workspace hook surface while improving test coverage.

---

## Checkpoint — 2026-05-14 — cycle 1 after PR #2

**Decision:** stop cycle 1 after two successful extractions and write the reassessment next. Do not start PR #3 in this cycle.

**Rationale:** The README exit criteria allow two or three extractions, and PR #1 + PR #2 already produced the intended signal: the loop caught a weak assertion in PR #1 and forced an explicit note for behavior-neutral callback coalescing in PR #2. The measurable LOC movement is modest but real for PR #1 (`useMainWindowWorkspace.ts` 4118 → 4099; cap 4119 → 4100), while PR #2 improved ownership/test coverage without lowering the hook further. Candidate B (`collectShadowDivergenceDevDiagnostics`) remains low-risk, but it is persistence-diagnostics-adjacent and would create another review pass over the same shadow-model area immediately after two small refactor reviews. Stopping now avoids review fatigue and gives the reassessment a cleaner read on whether this cadence should continue.

**Candidate B status:** carry forward as the first candidate for the next cycle, unless the reassessment changes cadence or pauses the team-scalability loop.

---

## PR — 2026-05-14 — #TBD — extract popNextReopenableClosedTabRecord

**Cycle:** 1
**Type:** pure refactor
**Author session:** sonnet 4.6 — cycle-1 extraction session

**What moved**

- From: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (inline `while` loop inside `reopenLastClosedEditorTab` callback, lines ~2251–2265)
- To: `apps/desktop/src/lib/editorClosedTabStack.ts` (new exported function, collocated with `isEditorClosedTabReopenable`)
- LOC delta source: 4099 → 4099 (`wc -l`; script-counted cap unchanged at 4100)
- LOC new module: `editorClosedTabStack.ts` grew from 81 → 101 (+20)
- Tests added: 4 new unit tests in `editorClosedTabStack.test.ts` (`popNextReopenableClosedTabRecord` describe block)

**Module budget**

- Baseline entries changed: none (LOC delta in `useMainWindowWorkspace.ts` is 0 — the while loop removal is offset by the hoisted `noteSet` computation and the function call; the cap of 4100 is met but not undercut)
- Direction: down only? yes (no entry raised; cap held)
- New file respects NEW_FILE_MAX_LINES (400)? yes (`editorClosedTabStack.ts` is 101 LOC; not tracked in the baseline JSON)

**Behavior**

- Behavior change: no
- **Intentional coalescing of `bumpEditorClosedStack()` calls.** The original loop called `bumpEditorClosedStack()` once per pop (N calls for N pops). The new caller calls it once when `popped > 0` (at most one call per invocation). This is not callback-identical to the original, but is explicitly behavior-neutral: `bumpEditorClosedStack` only snapshots `editorClosedTabsStackRef.current` into state (`setEditorClosedTabsStackSnapshot([...ref.current])`). All N calls within a single synchronous async-IIFE run are batched by React's automatic batching into one render with the final snapshot — the same result as one call after all pops. The coalescing is intentional and documented here rather than preserved via `for (let i = 0; i < popped; i++) bumpEditorClosedStack()`, which would be misleading about the actual effect.

**Verification**

- `npm run lint`: pass
- `npm test` (relevant workspace — `editorClosedTabStack.test.ts`): pass (10 tests)
- `npm run check:architecture`: pass
- Manual smoke test: n/a — pure refactor with no UI surface; callback dependency array unchanged

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

The inline while loop read from `editorClosedTabsStackRef.current` (the closed-tab LIFO stack, distinct from the danger-zone persistence surface) and mutated it via `pop()`. The extracted helper encapsulates that mutation — caller retains ownership of `bumpEditorClosedStack()` and `openMarkdownInEditor`. Positional parameter style was chosen over a params object to match the existing convention in `editorClosedTabStack.ts` (`isEditorClosedTabReopenable` uses positional params).

The LOC-neutral delta on `useMainWindowWorkspace.ts` is expected: the while loop (15 lines) is replaced by a one-line call, but the `noteSet` computation was hoisted out of the loop (saving 3 repeat allocations per call), the `popped` guard was added, and the `openMarkdownInEditor` branch gained an explicit `if (record)` check. Net: 0. The baseline cap is held at 4100 but not lowered this cycle.

---

## Review — 2026-05-14 — #TBD (cycle 1 PR #2)

**Reviewer session:** sonnet 4.6 — fresh session, no author context
**Reviewer prompt used:** standard reviewer prompt from logbook template (diff + original + extracted file + README danger-zone section)

**Prompt template for reusing this review:**

> You are reviewing a refactor PR for the Eskerra desktop app. Read:
> 1. The PR diff (files: `useMainWindowWorkspace.ts`, `editorClosedTabStack.ts`, `editorClosedTabStack.test.ts`).
> 2. The original callback before the refactor: `reopenLastClosedEditorTab` in `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (lines ~2247–2267).
> 3. The new extracted function: `popNextReopenableClosedTabRecord` in `apps/desktop/src/lib/editorClosedTabStack.ts`.
> 4. `specs/team-scalability/README.md` (especially the danger-zone section).
> 5. The relevant section of `CLAUDE.md`.
>
> Report:
> - Any closure / ref / dependency that was silently dropped or rebound.
> - Any state-mutation path in the original that is not preserved in the new code.
> - Any missing test that the original behavior implicitly depended on.
> - Whether the module-budget baseline was lowered correctly.
> - Whether any danger-zone file was touched.
>
> Be specific. Cite line numbers. Do not approve or reject — just list findings.

**Findings (verbatim from reviewer):**

No blocking findings. The reviewer confirmed:

1. No dropped closures or refs — the helper receives `stack`, `vaultRoot`, and `noteUriSet` as plain values; all ref reads stay in the callback.
2. No mutation paths missed — `pop()` semantics are preserved; the caller retains `bumpEditorClosedStack()` and `openMarkdownInEditor`.
3. The `bumpEditorClosedStack()` call-count coalescing (N calls → 1 call when `popped > 0`) is documented in the PR Behavior section and confirmed behavior-neutral under React automatic batching.
4. No danger-zone files touched. `editorClosedTabsStackRef` is not part of the cache/persistence/watcher/editor-save quadrangle.
5. Module-budget baseline: `editorClosedTabStack.ts` at 101 LOC is below both NEW_FILE_MAX_LINES (400) and GROWTH_TRACK_MIN_LINES (800); no baseline JSON entry required. `useMainWindowWorkspace.ts` cap held at 4100; not raised.
6. Four unit tests cover the four specified scenarios; each asserts exact remaining stack contents after mutation.

**Verdict:** accept.

**Resolutions:** no findings to resolve.

**Final status: accepted.**

---

## PR — 2026-05-14 — #TBD — extract injectActiveHubIntoTodayHubPersistMap

**Cycle:** 1
**Type:** pure refactor
**Author session:** opus 4.7 — cycle-1 extraction session

**What moved**

- From: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (inline block inside `legacyTodayHubWorkspacesPersistFiltered` useMemo, lines ~855–881)
- To: `apps/desktop/src/hooks/workspaceTodayHubDerived.ts` (new exported function at end of file)
- LOC delta source: 4118 → 4099 (`wc -l`; script-counted cap lowered from 4119 → 4100)
- LOC new module: `workspaceTodayHubDerived.ts` grew from 107 → 153 (+46)
- Tests added: 4 new unit tests in `workspaceTodayHubDerived.test.ts` (`injectActiveHubIntoTodayHubPersistMap` describe block)

**Module budget**

- Baseline entries changed: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (4119 → 4100)
- Direction: down only? yes
- New file respects NEW_FILE_MAX_LINES (400)? yes (`workspaceTodayHubDerived.ts` is 153 LOC)

**Behavior**

- Behavior change: no

**Verification**

- `npm run lint`: pass
- `npm test` (relevant workspace — `workspaceTodayHubDerived.test.ts`): pass (22 tests)
- `npm run check:architecture`: pass
- Manual smoke test: n/a — pure refactor with no UI surface; useMemo dependency array unchanged

**Danger-zone check**

- Touched cache / persistence / watcher / editor-save? no
- Touched `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`? no

**Notes**

The inline block after `mergeHomeHistoryIntoHubSnapshotsForPersist(...)` was a pure derivation reading five already-in-scope values and returning a new map. Moving it to `workspaceTodayHubDerived.ts` completes the trio: `deriveTodayHubWorkspacesPersistFiltered` → `mergeHomeHistoryIntoHubSnapshotsForPersist` → `injectActiveHubIntoTodayHubPersistMap`. The useMemo body shrinks from ~28 lines to ~8 lines; dependency array is unchanged.

Budget discrepancy note: `wc -l` reports 4099; the budget script (`split(/\r?\n/).length`) counts 4100 due to the trailing newline making one extra segment. The baseline was lowered to 4100 (script-compatible unit) to match the actual enforced number.

---

## Review — 2026-05-14 — #TBD (cycle 1 PR #1)

**Reviewer session:** sonnet 4.6 — fresh session, no author context
**Reviewer prompt used:** standard reviewer prompt from logbook template (diff + original + extracted file + README danger-zone section)

**Prompt template for reusing this review:**

> You are reviewing a refactor PR for the Eskerra desktop app. Read:
> 1. The PR diff (files: `useMainWindowWorkspace.ts`, `workspaceTodayHubDerived.ts`, `workspaceTodayHubDerived.test.ts`, `module-budget-baseline.json`).
> 2. The original file before the refactor: `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (lines ~842–890, `legacyTodayHubWorkspacesPersistFiltered` useMemo).
> 3. The new extracted file: `apps/desktop/src/hooks/workspaceTodayHubDerived.ts`.
> 4. `specs/team-scalability/README.md` (especially the danger-zone section).
> 5. The relevant section of `CLAUDE.md`.
>
> Report:
> - Any closure / ref / dependency that was silently dropped or rebound.
> - Any state-mutation path in the original that is not preserved in the new code.
> - Any missing test that the original behavior implicitly depended on.
> - Whether the module-budget baseline was lowered correctly.
> - Whether any danger-zone file was touched.
>
> Be specific. Cite line numbers. Do not approve or reject — just list findings.

**Findings (verbatim from reviewer):**

1. **Test coverage gap — active-hub-absent branch:** The test `'creates a new entry with homeHistory when the active hub is absent from merged'` passes `homeStatesByHub: {}`, so `homeStatesByHub[hub]` is undefined and the function falls through to `createWorkspaceHomeState(hub)` which creates a default (empty) history. The test only asserts `homeHistory` is defined, not that it has the correct shape. A caller who supplies a non-empty `homeStatesByHub` for the new hub would exercise different behaviour; the assertion should match exact `entries` and `index` from the supplied state. Not blocking — the code path is correct — but the weak assertion would survive a bug that mis-reads from the wrong hub.
2. **JSDoc comment imprecision:** The helper JSDoc says `"Pure: reads params only, returns a new map."` The null-active-hub branch intentionally returns `merged` by reference (identity, not a copy). A future caller might rely on this for memo equality checks; the comment should state this explicitly so the optimisation is not inadvertently removed.

No dropped dependencies, no stale closures, no mutation paths missed, no danger-zone files touched. Baseline was lowered correctly (4119 → 4100 in script-compatible units).

**Verdict:** accept with tiny follow-up on items 1 and 2.

**Resolutions:**

- Finding 1: addressed — test strengthened to supply an explicit `homeStatesByHub` entry with non-default `entries` and `index`, and assertion updated to match exact values.
- Finding 2: addressed — JSDoc updated to read `"Pure: reads params only, returning \`merged\` unchanged when no active hub is selected."` making the by-reference return explicit.
- Follow-up review: accepted — no further findings.

**Final status: accepted.**

---

## PR #2 candidate selection — 2026-05-14 — cycle 1

**Selected candidate:** Candidate C — `popNextReopenableClosedTabRecord`.

Reasoning:

- **Risk:** C stays on the closed-tab stack and does not touch the cache / persistence / watcher / editor-save quadrangle. B is also low-risk, but it sits in dev/test persistence divergence diagnostics immediately adjacent to PR #1's persistence-map work; doing another persistence-adjacent extraction next would concentrate review risk in the same area.
- **LOC reduction:** B likely removes more lines from `useMainWindowWorkspace.ts`; C removes fewer. For PR #2, the smaller reduction is acceptable because the loop is still validating extraction discipline after PR #1.
- **Testability:** C has the sharper test matrix: empty stack, first record reopenable, stale records before a valid record, and all stale. PR #1's review exposed that loose assertions can miss branch-specific behavior, so PR #2 should prefer the candidate whose expected mutations and return values are easiest to assert exactly.
- **Merge-conflict reduction:** B would reduce future conflict around dev diagnostics; C reduces conflicts around editor closed-tab behavior and moves that logic toward `editorClosedTabStack.ts`, where related predicates already live. C's reduction is smaller but cleaner.
- **Loop decision:** continue the two-week loop. PR #1 was accepted after tiny test/comment follow-ups; no process weakness warrants a pause. The adjustment for PR #2 is to write exact-value tests from the start, not just existence checks.

**Why B waits:** `collectShadowDivergenceDevDiagnostics` remains a good PR #3 candidate, but it is more coupled to the shadow-model persistence comparison context and will need careful tests around diagnostic suppression and pending projection hubs. Let C go next as the more mechanical extraction; return to B once the loop has two low-risk extractions through review.

---

## Baseline — 2026-05-14 — cycle 1

**Branch:** `cleaning-things-up`
**Commit:** `c21891f7`

Measurements:

- `useMainWindowWorkspace.ts` LOC: **4118**
- Workspace-related sibling hooks LOC sum: **4855** (21 files matching `apps/desktop/src/hooks/workspace*.ts`, excluding `*.test.ts`)
- `react-hooks/exhaustive-deps` warnings in `useMainWindowWorkspace.ts`: **0**
- `eslint-disable` occurrences under `apps/desktop/src/`: **13** (raw lines; `npm run check:architecture` exits 0 against the current baseline in `scripts/eslint-disable-baseline.json`)
- Test file count under `apps/desktop/src/`: **178** (`*.test.ts` + `*.test.tsx`)
- `apps/desktop/src/lib/` root-level file count: **142** (regular files only, subdirectories excluded)
- `npm run check:architecture` status: **pass** (exit 0)

Commands used:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
wc -l apps/desktop/src/hooks/useMainWindowWorkspace.ts
ls apps/desktop/src/hooks/workspace*.ts | grep -v "\.test\." | xargs wc -l | tail -1
( cd apps/desktop && npx eslint src/hooks/useMainWindowWorkspace.ts ) \
  | grep -c "react-hooks/exhaustive-deps"
grep -rn "eslint-disable" apps/desktop/src --include="*.ts" --include="*.tsx" | wc -l
node scripts/check-eslint-suppressions.mjs
find apps/desktop/src -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) | wc -l
find apps/desktop/src/lib -maxdepth 1 -type f | wc -l
npm run check:architecture
```

Measurement notes:

- `react-hooks/exhaustive-deps` count is **0** today. The earlier May 04 follow-up recorded 26 warnings on this file; the rule appears to have been resolved in the interim. Recording 0 honestly; cycle 1 will not be measured against the older 26 figure.
- "ESLint suppression count" in the README template maps to the raw `eslint-disable` line count above. The repo script (`check-eslint-suppressions.mjs`) validates against a baseline list and exits 0/1; it does not emit a single suppression number. The 13-line raw count is the cleanest comparable measure.
- LOC is measured with `wc -l` (newline count), matching the convention used by `scripts/check-module-budgets.mjs`.

### Candidates considered for extraction

Audited by reading `useMainWindowWorkspace.ts` against the danger-zone list. Many initially promising callbacks (disk-conflict resolvers, merge-view orchestration, `deleteNote`, `deleteFolder`, `bulkDelete*`, `applyBackgroundNewTabOpen`, `loadOpenedNoteBodyAndApplySelection`, `hydrateVault`, `closeAllEditorTabs`) were ruled out because they touch `lastPersistedRef`, `inboxContentByUri`, `autosaveSchedulerRef`, or `enqueuePersistOutgoingNoteMarkdown`. The three candidates below all avoid that surface.

#### Candidate A — `injectActiveHubIntoTodayHubPersistMap` (pure helper)

1. **Name:** `injectActiveHubIntoTodayHubPersistMap`
2. **Current responsibility:** Final step of `legacyTodayHubWorkspacesPersistFiltered` (the `useMemo` in `useMainWindowWorkspace.ts`) that overlays the live `editorWorkspaceTabs` / `activeEditorTabId` / `homeStatesByHub[hub]` onto an already-filtered, already-merged hub-workspaces map before persist.
3. **Source line range:** `useMainWindowWorkspace.ts` lines ~842–890 (the inline portion after the calls to `deriveTodayHubWorkspacesPersistFiltered` and `mergeHomeHistoryIntoHubSnapshotsForPersist`).
4. **State ownership:** None held. Reads only the values already passed into the existing `useMemo` (`activeTodayHubUri`, `editorWorkspaceTabs`, `activeEditorTabId`, `homeStatesByHub`, plus the merged map produced by sibling pure helpers).
5. **Inputs:** `{merged: Record<string, TodayHubWorkspaceSnapshot>, activeTodayHubUri: string | null, homeStatesByHub: Record<string, WorkspaceHomeState>, editorWorkspaceTabs: EditorWorkspaceTab[], activeEditorTabId: string | null}`. **Outputs:** new `Record<string, TodayHubWorkspaceSnapshot>`.
6. **Files likely touched:** `apps/desktop/src/hooks/workspaceTodayHubDerived.ts` (add the helper next to its siblings), `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (call it from the existing `useMemo`), and a new colocated `*.test.ts`.
7. **Existing tests:** `workspaceTodayHubDerived` is exercised indirectly via `useMainWindowWorkspace.hydrateVault.test.ts` and the integration harness; no direct test for this specific overlay logic.
8. **Missing tests to add:** Direct unit tests in `workspaceTodayHubDerived.test.ts` (new): (a) `activeTodayHubUri == null` returns input unchanged; (b) hub absent in `merged` — creates entry from current tabs + active id + `createWorkspaceHomeState`; (c) hub present in `merged` — preserves prior `homeHistory`, overrides `editorWorkspaceTabs` + `activeEditorTabId`; (d) `tabsToStored` is applied (round-trip with empty tabs).
9. **Danger-zone analysis:** No refs touched. No `lastPersistedRef` / `inboxContentByUri` / `saveNoteMarkdown`. No FS, no async, no watcher, no editor save. Pure derivation on plain inputs. **Outside all danger zones.**
10. **Risk:** **low**.
11. **Merge-conflict reduction:** Future changes to the today-hub persist shape (a frequently touched area) land in `workspaceTodayHubDerived.ts` instead of `useMainWindowWorkspace.ts`. Removes a self-contained ~30-line block from the megahook.

#### Candidate B — `collectShadowDivergenceDevDiagnostics` (pure helper)

1. **Name:** `collectShadowDivergenceDevDiagnostics`
2. **Current responsibility:** Body of the dev/test-only `useEffect` that compares model-derived persistence to legacy runtime persistence and `console.warn`s on divergence (`[workspaceModel] persistence legacy divergence`).
3. **Source line range:** `useMainWindowWorkspace.ts` lines ~896–937.
4. **State ownership:** None. The effect reads `inboxShellRestored`, `workspaceShadowModel`, `modelDerivedPersistence`, `legacyTodayHubWorkspacesPersistFiltered`, `activeTodayHubUri`, `hubForProjection`, `restoredInboxState`, `todayHubWorkspacesForProjection`. It writes nothing back to React state or refs.
5. **Inputs:** the readonly snapshot above. **Outputs:** `{diffs: string[]; suppress: boolean}` — empty `diffs` or `suppress: true` means no warning.
6. **Files likely touched:** `apps/desktop/src/hooks/workspacePersistenceBridge.ts` (add helper alongside `describeFilteredLegacyVsModelPersistenceDivergence`), `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (effect body becomes 5–6 lines calling the helper + `console.warn`), and a new colocated `*.test.ts`.
7. **Existing tests:** None for this effect directly.
8. **Missing tests to add:** Unit tests for the helper: suppress when `inboxShellRestored === false`; suppress when not dev/test; suppress when `workspaceShadowModel.activeHub === null`; non-empty diffs when projection contains pending hubs not yet in the model.
9. **Danger-zone analysis:** Dev-mode telemetry only. No persistence writes, no cache writes, no watcher, no editor save. Worst-case regression: noisier or quieter `console.warn` in dev/test. No user-visible behavior. **Outside all danger zones.**
10. **Risk:** **low**.
11. **Merge-conflict reduction:** Moves a chunk of dev-observability logic to a sibling file that already owns `describeFilteredLegacyVsModelPersistenceDivergence`. Future tuning of divergence filtering lands there, not in the megahook.

#### Candidate C — `popNextReopenableClosedTabRecord` (pure helper)

1. **Name:** `popNextReopenableClosedTabRecord`
2. **Current responsibility:** The `while` loop inside `reopenLastClosedEditorTab` that pops records off the closed-tab stack until it finds one whose URI is still reopenable against the current vault + notes set.
3. **Source line range:** `useMainWindowWorkspace.ts` lines ~2266–2286.
4. **State ownership:** Mutates only `editorClosedTabsStackRef.current` (pop semantics). The closed-tab stack is **not** in the danger-zone quadrangle.
5. **Inputs:** `{stack: ClosedEditorTabRecord[] (mutated by pop), vaultRoot: string | null, noteUriSet: Set<string>}`. **Outputs:** `{record: ClosedEditorTabRecord | null, popped: number}`. Caller still owns `bumpEditorClosedStack()` and the `openMarkdownInEditor` invocation.
6. **Files likely touched:** `apps/desktop/src/lib/editorClosedTabStack.ts` (already houses `isEditorClosedTabReopenable`), `apps/desktop/src/hooks/useMainWindowWorkspace.ts` (callback shrinks to ~6 lines), `editorClosedTabStack.test.ts` (extend).
7. **Existing tests:** `editorClosedTabStack.test.ts` covers `isEditorClosedTabReopenable` and stack-push helpers; no direct test for "pop until reopenable" semantics.
8. **Missing tests to add:** empty stack → `{record: null, popped: 0}`; top entry reopenable → `popped === 1`; first two entries stale, third reopenable → `popped === 3`, returned record is the third; all stale → all popped, `record === null`.
9. **Danger-zone analysis:** Only mutates the closed-tab stack ref. Does not touch `lastPersistedRef`, `inboxContentByUri`, `saveNoteMarkdown`, watcher state, or editor-save flow. The caller still drives `openMarkdownInEditor`, which is left untouched. **Outside all danger zones.**
10. **Risk:** **low**.
11. **Merge-conflict reduction:** Smaller LOC delta than A or B, but consolidates closed-tab stack behavior into one module — future tweaks to "which closed tabs can be reopened" land in `editorClosedTabStack.ts`, not the megahook.

### Selected candidate

**Candidate A — `injectActiveHubIntoTodayHubPersistMap`.**

Reason for selection:

- **Smallest blast radius.** Pure derivation, no refs, no async, no FS. The diff is a function move plus a delegation call.
- **Highest test ROI.** Four crisp unit tests fully cover the helper; no integration harness needed.
- **Natural home already exists.** `workspaceTodayHubDerived.ts` is the established sibling for `deriveTodayHubWorkspacesPersistFiltered` and `mergeHomeHistoryIntoHubSnapshotsForPersist`; this helper completes the trio.
- **Danger-zone-free.** Reads only the values already inside the `useMemo`; writes nothing. Does not interact with `lastPersistedRef`, `inboxContentByUri`, `saveNoteMarkdown`, watcher state, or editor-save behavior. The persist write itself remains in the unchanged `workspacePersistence` path.
- **Confidence-builder for the loop.** First PR in the cycle should be the one most likely to merge cleanly and produce a reviewer comment about *style*, not *correctness*. Candidate A fits that role best; B and C are good fallbacks for PR #2 and PR #3.
