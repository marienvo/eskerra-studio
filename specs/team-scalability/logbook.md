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
