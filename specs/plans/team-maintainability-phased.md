# Team Maintainability — Phased Plan (2026-06-10)

## name

Team Maintainability Phased Plan — make `apps/desktop` safe for parallel multi-contributor work and legible to juniors. Supersedes the actionable remainder of `.me/monthly-reports/report-2026-05-17-consolidated-plan.md`.

## overview

The May 17 consolidated plan is roughly half executed. Done since then: `useMainWindowWorkspace.ts` 1,750 → 1,286 LOC with five domain subdirs split out of `hooks/`; `VaultTab.tsx` 1,497 → 244; `NoteMarkdownEditor.tsx` 1,525 → 460; `App.tsx` 712 → 389; four `ARCHITECTURE.md` feature docs; PR template; `CONTRIBUTING.md`.

Not done, and now reprioritized here:

1. **The module-budget ratchet is leaking.** In the last 7 days `TodayHubCanvas.tsx` was bumped 1,010 → 1,280 across seven baseline increments, and a brand-new 1,000-line module (`normalizeAgenda.ts`) was born and baselined in the same week. The "baseline only goes down" rule exists on paper but nothing enforces it socially or mechanically.
2. **CSS is invisible to the ratchet.** `check-module-budgets.mjs` only scopes `.ts`/`.tsx`, so `App.css` (now 7,140 lines, +228 since May 17) grows unmeasured.
3. **Editor megamodules** are untouched since April: `EskerraTableShell.tsx` 1,702, `markdownSmartExpandSelection.ts` 1,498, `markdownSelectionSurround.ts` 1,356, `FrontmatterEditor.tsx` 1,202, `VaultPaneTree.tsx` 1,107.
4. **`hooks/` and `lib/` roots are still flat dumps**: 81 and 76 non-test loose files respectively (targets ≤ 25 each).
5. **Rust `unwrap()/expect()/panic!` is at 271** (was 275); `vault_git_sync/status.rs` grew 53 → 55. The error-convention work never started.
6. **Spec drift persists**: `specs/team-scalability/current-status.md` still cites `useMainWindowWorkspace.ts` at 4,062 LOC against a real 1,286.

Primary goal (unchanged from May): multiple contributors can work on different features without colliding, and a junior can follow the main lines of any feature without reading the orchestrator.

Each phase lists a **model recommendation** per work item. Legend: *Opus high* = Claude Opus, high reasoning effort (judgment-heavy, stateful, data-loss-adjacent); *Sonnet medium* = Claude Sonnet, medium effort (well-tested, pattern-following); *Composer 2.5* = fast agentic model (mechanical, high-volume, low-judgment); *GPT 5.5 XHigh* = maximum-reasoning second opinion (adversarial review, regex/algorithmic analysis). The principle: spend reasoning on decisions, not on typing.

## non-goals

- **Mobile. Entirely.** `apps/mobile` is scheduled for removal. No mobile READMEs, no mobile baseline maintenance, no mobile refactors. Mobile entries leave the baselines in Phase 0 when the directory is deleted, or are frozen until then.
- Workspace tab/shadow-model big-bang rewrite (stays "by design" shadow).
- Converting Rust errors to `anyhow`/`eyre` (use existing typed errors).
- Rewriting working editor behavior for style points; every split is behavior-preserving.
- New features. This plan competes with feature work for review bandwidth; that is the point.

## current state (verified 2026-06-10, branch `new-plans-pt2`)

| Metric | Value | Target |
|---|---:|---:|
| `useMainWindowWorkspace.ts` | 1,286 | ≤ 800 |
| `TodayHubCanvas.tsx` | 1,279 (was 1,010 a week ago) | ≤ 800 |
| `EskerraTableShell.tsx` | 1,702 | ≤ 1,000 |
| `markdownSmartExpandSelection.ts` | 1,498 | ≤ 800 |
| `markdownSelectionSurround.ts` | 1,356 | ≤ 800 |
| `FrontmatterEditor.tsx` | 1,202 | ≤ 800 |
| `VaultPaneTree.tsx` | 1,107 | ≤ 800 |
| `normalizeAgenda.ts` (eskerra-core) | 1,010 | ≤ 800 |
| `useMainWindowWorkspace.hydrateVault.test.ts` | 1,683 | split by scenario |
| `App.css` | 7,140 (unmeasured by ratchet) | measured; ≤ 3,500 |
| `hooks/` root non-test files | 81 | ≤ 25 |
| `lib/` root non-test files | 76 | ≤ 25 |
| Rust `unwrap()/expect()/panic!` (src-tauri) | 271 | ≤ 80 |
| Feature docs (`ARCHITECTURE.md`) | 4 | ≥ 9 |
| `CODEOWNERS` | absent | present |

## phase 0 — stop the bleeding: ratchet integrity (≈ 1 week, blocks nothing, do first)

The ratchet only works if bumping it hurts. Right now it is bumped silently in "Fix lint errors" commits.

1. **Extend `check-module-budgets.mjs` to CSS.** Scope `.css` files under `apps/desktop/src/` (excluding `*.module.css`, which are the desired end state). Baseline `App.css` at its current line count. This makes Phase 5 measurable and stops silent growth today. — *Sonnet medium* (the script has tests; follow them).
2. **Make baseline growth loud.** `update-module-budget-baseline.mjs` gains a required `--reason "<text>"` flag when any entry increases; the reason is written into the baseline JSON next to the entry (`"_growth": [{date, delta, reason}]` or similar) and surfaced by the PR-template checklist. A bump without a reason fails CI. — *Sonnet medium* for the script, *Opus high* for a one-page policy paragraph in `CONTRIBUTING.md` saying when growth is acceptable (hot feature mid-flight) and when it is not.
3. **Drop mobile from the baselines** the moment `apps/mobile` is deleted; until then freeze mobile entries (no bumps accepted). Remove `apps/mobile/` from `isScopedSource` in the same PR that deletes the directory. — *Composer 2.5* (mechanical).
4. **Audit the five file-level `sonarjs/slow-regex` disables** in `lib/markdown/cleanNote/`. These blanket-exempt a ReDoS-class rule across the exact code that parses arbitrary user markdown — and CodeQL found a real ReDoS in `normalizeAgenda` this week, so the rule is not crying wolf in this codebase. Convert each file-level disable to per-line disables with a per-regex rationale (the pattern `wikiLinkAutocomplete.ts:17` already uses); any regex that cannot be justified per-line gets rewritten or bounded. Update `eslint-disable-baseline.json` accordingly — the `allowedFileLevelEslintDisablePaths` list should end this phase empty. — *GPT 5.5 XHigh* for the regex-by-regex ReDoS analysis (this is exactly what maximum-reasoning models are for), *Sonnet medium* to apply the verdicts.
5. **Bring `react-hooks/exhaustive-deps` suppressions under a ratchet.** There are ~25 of them and they are the riskiest suppression class in this codebase (stale-closure bugs in the dangerous quadrangle), yet the suppression gate only fingerprints `sonarjs/*`. Extend `check-eslint-suppressions.mjs` to fingerprint `react-hooks/*` disables into the baseline so new ones require a baseline edit in the diff. Do **not** try to fix the existing ones here — most rationales ("reads shell refs", "keyed on note selection") describe a deliberate ref-bridge pattern. — *Sonnet medium*.
6. **Fix spec drift.** Reconcile `specs/team-scalability/current-status.md` with `wc -l` reality (4,062 → 1,286 etc.), or add a footnote explaining the counting scheme. A status doc that is off by 3× trains readers to ignore all status docs. — *Composer 2.5* (verify numbers with a script, not by hand).

**Exit:** CSS in ratchet; growth requires a written reason; `allowedFileLevelEslintDisablePaths` empty; `react-hooks` suppressions fingerprinted; status doc truthful.

## phase 1 — the active fire: Today Hub canvas + calendar pipeline (≈ 2 weeks, start immediately after 0.1–0.2)

All of last week's growth landed in two places. Split them while the team's mental model is hot, not after it fades.

0. **Seam regression test first** (carried from the May plan's "Fase 0 safety net", consciously slimmed): one behavior-level Vitest scenario for the quadrangle seam — edit note → switch away → switch back → save/reopen ⇒ body identical to last user edit unless a conflict is shown. The May ambition of full Tauri E2E with fake-FS fallback is dropped (no E2E infra exists and its design doc was lost with the May 16 plan); a hook-level test against the real reconcile/persistence modules is the 20% that buys 80%. This test must exist **before** the canvas split below and must survive it. — *Opus high* (test design is the judgment; the quadrangle is exactly where naive mocks lie).
1. **`TodayHubCanvas.tsx` 1,279 → ≤ 800.** The `sonarjs/cognitive-complexity` suppression at line 1086 marks the seam: the warm/CodeMirror/static cell stack. Extract `TodayHubCanvasNonEmptyCell` rendering and the live-row disk-sync bridge (`today-hub-week-cell-live-row-disk-sync.md` plan landed last week) into siblings under `components/todayHub/`. This file is adjacent to the dangerous quadrangle (cell content ↔ disk truth); every extraction needs the markdown-integrity review skill run on it. — *Opus high*, one extraction per PR, behavior-preserving, existing `TodayHubCanvas.test.tsx` green plus a snapshot of cell render output before/after.
2. **`normalizeAgenda.ts` 1,010 → ≤ 800 via decomposition, not compression.** It is one week old, pure-functional, and already has snapshot tests — the cheapest possible split. Likely seams: per-rule normalize passes → one module per pass, mirroring the `cellMerge/` layout that already exists next door. — *Sonnet medium*; *GPT 5.5 XHigh* one-shot review of the regex inventory while it is open (this file already had a ReDoS).
3. **Split `useMainWindowWorkspace.hydrateVault.test.ts` (1,683 lines) by scenario.** Giant test files are where juniors drown first; scenario-named files double as documentation. No production code changes. — *Composer 2.5*.

**Exit:** both files ≤ 800 in the baseline with no other entry increased; test file split; quadrangle invariant (switch away/back ⇒ identical body) covered by an explicit test that survived the canvas split.

## phase 2 — navigability: empty the `hooks/` and `lib/` roots (≈ 2 weeks, parallel with phase 1 — different files, different owner)

This is the highest-leverage junior-readability work: today "everything for git sync" means scanning 81 root files.

1. **`hooks/` root 81 → ≤ 25.** The five domain subdirs already exist (`workspace/`, `mainWindowWorkspace/`, `todayHub/`, `workspacePersistence/`, `workspaceVaultWatch/`); add `vault/`, `editor/`, `playback/`, `reminders/`, `window/` per the May plan's table. Moves only — **never combine a move with a behavior change in one PR** (rule carried over from May, still binding). — *Composer 2.5* for the moves and import updates (purely mechanical, high volume); *Opus high* for one upfront decision document: the final folder map and which hooks stay root-level (truly cross-cutting ones).
2. **`lib/` root 76 → ≤ 25.** Same recipe into the ten existing subdirs plus `gitSync/` and `tauri/` from the May plan. — same model split as 2.1.
3. **Enforce the boundary.** Extend the existing `no-restricted-imports` config (three rules already in `apps/desktop/eslint.config.js`) so cross-domain imports go through each domain's `index.ts`. Start with `hooks/workspace/` ↔ `hooks/todayHub/`, expand per domain as it fills. — *Sonnet medium*.
4. **README per domain folder, ≤ 10 lines** (what lives here / what must not). — write alongside each move PR, same author/model.

**Exit:** both roots ≤ 25 non-test files; ESLint boundary active for ≥ 2 domains; every domain folder has a ≤ 10-line README.

## phase 3 — remaining editor megamodules (≈ 4–6 weeks, after phase 1; one module at a time)

Order by (risk × reader traffic), easiest first to build the playbook:

1. **`markdownSelectionSurround.ts` (1,356) and `markdownSmartExpandSelection.ts` (1,498).** Pure logic, extensively tested (846-line test file as safety net). Split by markdown construct (lists / tables / inline marks / code fences). — *Sonnet medium*; these are the canonical "well-tested pure function" case and do not deserve Opus.
2. **`FrontmatterEditor.tsx` (1,202).** Component split by field-type editor. Storybook stories first if missing. — *Sonnet medium*, *Opus high* only for the state-ownership cut (which state stays in the shell).
   Rule for every module in this phase: each extracted UI surface gets Storybook coverage for normal + edge states in the same PR (May success item, kept).
3. **`VaultPaneTree.tsx` (1,107).** Tree rendering vs. drag-drop vs. context-menu commands. — *Sonnet medium*.
4. **`EskerraTableShell.tsx` (1,702 → ≤ 1,000, not 800).** Hardest file in the repo: CodeMirror lifecycle, compartments, cell focus, an exhaustive-deps suppression at line 1640. Do last, with the playbook from 3.1–3.3 and Phase 0's suppression ratchet in place. — *Opus high*, mandatory second-model review (*GPT 5.5 XHigh*) on every PR, plus the state-consistency review skill.

**Exit:** no `.ts/.tsx` production file in `apps/desktop/src/` above 800 except `EskerraTableShell.tsx` ≤ 1,000; baseline entries deleted (not lowered — deleted) as files drop under `GROWTH_TRACK_MIN_LINES`.

## phase 4 — docs for the second contributor (≈ 1 week, fully parallel with everything)

The four existing `ARCHITECTURE.md` files (noteEditor, workspacePersistence, workspaceVaultWatch, mainWindowWorkspace) prove the format works. Finish the set, desktop only:

1. New `ARCHITECTURE.md` (20–60 lines, the May plan's 8-section template: purpose / boundaries / key files / state ownership / invariants / tests to run / dependents / failure modes) for: **Today Hub** (`components/todayHub/`), **calendar pipeline** (`packages/eskerra-core/src/calendarPipeline/` — brand new, undocumented, already 1,000+ lines), **git sync** (`src-tauri/src/vault_git_sync/`), **vault search** (`src-tauri`), **frontmatter editor**. — *Opus high*; doc quality is judgment, and a wrong invariant in a doc is worse than no doc. Have *GPT 5.5 XHigh* fact-check each doc against the code in review.
2. **`CODEOWNERS`** mapping the domain folders from Phase 2 — map function, not gatekeeping. — *Composer 2.5*.
3. **Onboarding walkthrough** `specs/architecture/onboarding-desktop.md` (≤ 200 lines): startup spine → workspace hook → editor → disk. Written for the junior persona; success test = a new contributor lands a one-feature PR without opening `useMainWindowWorkspace.ts`. — *Opus high*.
4. Index the feature docs from root `README.md` and `AGENTS.md`.
5. **5–10 good-first-issues** filed from the small, isolated leftovers this plan generates (domain-folder READMEs, per-line disable conversions, test-file splits). Cheap, and the only item here that directly exercises the "second contributor" goal. — *Composer 2.5* drafts, human picks.

**Exit:** ≥ 9 feature docs; CODEOWNERS present; onboarding doc merged; index links live.

## phase 5 — `App.css` unbundling (ongoing background work, after phase 0 makes it measurable)

7,140 lines of global CSS means every styling PR touches the same file — the definition of contributors colliding. Extraction order unchanged from May (Settings → Podcast → App shell → Vault tree → Editor toolbar → Today Hub → Table → CodeMirror), one surface per PR, into co-located `*.module.css`.

- Rule per PR: move + scope selectors only; no visual redesign; before/after screenshots in the PR (the repo's verify/Storybook tooling covers this).
- New UI already defaults to CSS Modules (recent `dateToken/` work shows the pattern is established — follow it).
- *Composer 2.5* for extraction volume with screenshot verification; *Sonnet medium* for surfaces with selector specificity hazards (CodeMirror, table). No Opus needed — this is careful labor, not judgment.

**Exit:** `App.css` ≤ 3,500 lines (ratcheted via Phase 0.1), zero new selectors added to it after this plan merges.

## phase 6 — Rust error convention (≈ 2–3 weeks, fully parallel; different language, zero file overlap with phases 1–5)

271 `unwrap()/expect()/panic!` in `src-tauri`, ~165 in `vault_git_sync` alone. A vault in an unexpected state can panic a Tauri command instead of returning a typed error to the UI.

1. **Convention doc first** (`specs/architecture/rust-error-conventions.md`, ≤ 100 lines): when `unwrap` is acceptable (post-validation invariant, tests), when not (user input, FS state, git state), what error type commands return. One doc PR before any refactor PR, or every refactor becomes a style debate. — *Opus high*.
2. **`vault_git_sync/status.rs`** (55 → ≤ 10) via `?` on the existing error type. — *GPT 5.5 XHigh* or *Sonnet medium*; mechanical once the convention exists, but git-state edge cases reward a strong reviewer.
3. **`sync_run.rs` + `stage_plan.rs` + `local_commit.rs` + `lock.rs`** (~109 → ≤ 25). — same.
4. **`vault_search_index.rs` + remaining** (~27 → ≤ 10). — *Sonnet medium*.
5. **Ratchet it**: a `check-rust-unwrap-budget` script mirroring the module-budget pattern, baseline at the post-refactor count. — *Sonnet medium*.
6. **File-watcher review leftovers** (carried from May; the detailed write-ups lived in the deleted May 16 plan, so the codes below are all that survives): M2 visibility gate, M4 half-loaded state, M5 Drop guard, H2 thresholds, L1–L7 cleanup PR. Re-derive each item from a fresh read of `vault_watch.rs` + the TS reconcile path before fixing; partial observability is already specced in `specs/observability/desktop-vault-watch-coarse-alert.md`. Budget one PR for the re-derivation doc, then fix-PRs as warranted. — *Opus high* for the re-derivation (it is a code review), *Sonnet medium* for fixes.

**Exit:** total ≤ 80; every survivor carries a one-line rationale comment; ratchet script in CI; watcher leftovers re-derived and either fixed or explicitly closed as won't-fix.

## sequencing and parallel ownership

```
week 1      : Phase 0 (one person, tooling)
weeks 2–3   : Phase 1 (owner A) ∥ Phase 2 (owner B) ∥ Phase 6.1–6.2 (owner C, Rust)
weeks 3–4   : Phase 4 (any owner, gaps between PRs) ∥ Phase 6.3–6.4
weeks 4–9   : Phase 3 (owner A) ∥ Phase 5 (owner B, background) ∥ Phase 6.5
```

Phases 1, 2, and 6 touch disjoint file sets by construction — they are the proof-of-concept for the plan's own goal. If a Phase 2 move PR and a Phase 1 split PR ever want the same file, the split wins and the move waits.

## validation per PR (binding)

- Moves and behavior changes never share a PR.
- Any PR touching a file with an `ARCHITECTURE.md` updates it in the same PR.
- Baseline entries only decrease, except with a written `--reason` (Phase 0.2).
- Quadrangle-adjacent PRs (Today Hub cells, editor persistence, watch reconcile) run the markdown-integrity and state-consistency review skills before merge.
- Quality gate per `AGENTS.md`: relevant tests, lint, type-check green before merge.

## definition of success (6 months)

1. No production `.ts/.tsx` in `apps/desktop/src/` over 800 LOC except `EskerraTableShell.tsx` ≤ 1,000.
2. `hooks/` and `lib/` roots ≤ 25 non-test files each, ESLint-enforced domain boundaries.
3. `App.css` ≤ 3,500 and ratcheted; new UI styling is CSS Modules only.
4. Rust unwrap count ≤ 80 and ratcheted.
5. ≥ 9 feature `ARCHITECTURE.md` docs, indexed from `README.md`/`AGENTS.md`; CODEOWNERS live.
6. Baseline history shows zero unexplained increases after Phase 0 lands.
7. A new contributor lands a meaningful single-feature PR within one day without reading `useMainWindowWorkspace.ts`.
8. `@ts-ignore`/`@ts-expect-error` in desktop + packages production code ≤ 40 (currently 78; opportunistic — burn down whenever a file is open for other reasons, no dedicated PRs).
9. Main UI surfaces have Storybook coverage for normal + edge states.
