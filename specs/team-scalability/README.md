# Team Scalability Working Spec

Process spec for the team-scalability initiative kicked off by the May 14, 2026 desktop audit.

## Purpose

Team Scalability was the weakest category in the May 14 audit (5/10). This document defines how we work on it: small extractions, measured before and after, reviewed by a second model, logged. It is the rulebook for the next iterations — not a roadmap, not a backlog.

Related documents:
- Parent audit: [`.me/monthly-reports/report-2026-05-14.md`](../../.me/monthly-reports/report-2026-05-14.md)
- Follow-up plan: [`.me/monthly-reports/report-2026-05-14-follow-up.md`](../../.me/monthly-reports/report-2026-05-14-follow-up.md)
- Earlier related plan: [`.me/monthly-reports/report-2026-05-04-follow-up.md`](../../.me/monthly-reports/report-2026-05-04-follow-up.md)
- Logbook: [`logbook.md`](./logbook.md)

## Current hotspots

In order of merge-conflict risk, highest first:

1. `apps/desktop/src/hooks/useMainWindowWorkspace.ts` — large orchestration kernel. Owns workspace state, FS reconcile wiring, editor tab logic, link routing, history, rename maintenance. Single biggest serial bottleneck.
2. Editor megamodules: `EskerraTableShell.tsx`, `NoteMarkdownEditor.tsx`, `markdownSmartExpandSelection.ts`, `markdownSelectionSurround.ts`, `FrontmatterEditor.tsx`, `VaultTab.tsx`, `TodayHubCanvas.tsx`. Each is large enough that parallel work on the same file is impractical.
3. `apps/desktop/src/lib/` — a flat directory with too many root-level files. Discoverability declines linearly with file count.
4. Missing contributor surface — no `CONTRIBUTING.md`, no `CODEOWNERS`, no PR template, no onboarding spec.

Exact LOC values are tracked in [`scripts/module-budget-baseline.json`](../../scripts/module-budget-baseline.json). The baseline is the source of truth; do not duplicate numbers here.

## Working principles

1. **Behavior preservation first.** Each PR is either a pure refactor (no behavior change) or a documented behavior change. Never both in the same PR.
2. **Audit before extracting.** Candidate extraction areas are mapped by reading the code, not by guessing from names.
3. **Small, manually reviewable PRs.** A reviewer should be able to hold the whole diff in their head. If the diff cannot fit in a 30-minute review window, split it.
4. **Module budgets only move downward.** Every extraction lowers the baseline in [`scripts/module-budget-baseline.json`](../../scripts/module-budget-baseline.json). No PR may raise an existing budget. New files must respect the `NEW_FILE_MAX_LINES` (400) and `GROWTH_TRACK_MIN_LINES` (800) thresholds in [`scripts/check-module-budgets.mjs`](../../scripts/check-module-budgets.mjs).
5. **Log every PR.** No extraction is complete until its row is in [`logbook.md`](./logbook.md).
6. **Second-model review is mandatory for refactors.** See "Model/prompt workflow" below. A green CI run is not sufficient on its own for orchestration code.
7. **Pure-helper extraction beats wrapper-hook extraction.** Prefer moving logic into a tested pure function over creating another React hook that wraps the same closures.
8. **Tests come with the code.** New extracted modules ship with their own `*.test.ts` next to them.

## Danger zones

Do not touch these without explicit prior alignment and additional test coverage:

- **Cache / persistence / watcher / editor-save quadrangle.** Specifically: `inboxNoteBodyCache.ts`, `workspacePersistence*`, `workspaceFsWatchReconcile.ts`, `workspaceVaultWatchEffects.ts`, and any code path that touches `lastPersistedRef`, `inboxContentByUri`, or `saveNoteMarkdown`. These are correctness-critical for user data and have explicit invariants in [`CLAUDE.md`](../../CLAUDE.md) and [`specs/architecture/desktop-editor.md`](../architecture/desktop-editor.md).
- **`NoteMarkdownEditor.tsx`.** Off-limits for refactors until desktop E2E coverage around note edit/save/switch exists (see the May 04 follow-up).
- **`EskerraTableShell.tsx`.** Off-limits until table-specific test coverage is expanded. The CodeMirror decoration cycle inside this file is fragile.
- **Rust-side files in `apps/desktop/src-tauri/src/vault_watch.rs` and `vault_git_sync/`.** Out of scope for the team-scalability initiative; covered by their own specs.
- **CSS layout invariants.** `cm-line` / decoration height-map rules in `specs/architecture/desktop-editor.md` are non-negotiable for editor click correctness.

If you believe a danger-zone change is necessary, file a spec note first and pause this loop.

## Two-week control loop

The first two weeks run as a tight, repeatable loop. The goal is to learn how scalable extractions feel in this codebase before committing to a multi-week refactor.

```
Day 1        Baseline
              - Snapshot module-budget metrics, lint warnings, test counts.
              - Open a logbook baseline entry.
              - Do not select an extraction candidate yet.

Day 2-4      Audit candidates
              - Identify 2-3 candidate extractions from the workspace hook.
              - Map inputs, outputs, state, and danger-zone touchpoints.
              - Select ONE candidate only after the audit.
              - Write a 5-10 line plan in the logbook PR entry.

Day 5-7      Implement extraction PR #1
              - Pure refactor. No behavior change.
              - New module < 400 LOC. Tests colocated.
              - Lower the baseline JSON in the same PR.
              - Update logbook PR entry with before/after numbers.

Day 8        Second-model review
              - Run the reviewer prompt (see "Model/prompt workflow").
              - Capture findings as a logbook review entry.
              - Address review items in a follow-up PR if needed.

Day 9-13     Repeat with PR #2 (and at most PR #3)
              - Same loop. New candidate. Same constraints.

Day 14       Reassess
              - Compare metrics to baseline.
              - Decide: continue loop, change cadence, or pause.
              - Write a reassessment entry in the logbook.
```

Hard limits for the two-week window:

- At most three extraction PRs total. If you need a fourth, stop and reassess instead.
- No phase-2 (`src/lib/` reorganization) or phase-3 (editor megamodules) work yet. Only phase-1 extractions from the workspace hook.
- No CODEOWNERS or contributor-process expansion mid-loop. Contributor-facing infrastructure (`CODEOWNERS`, `CONTRIBUTING.md`, a PR template, onboarding spec) belongs to a later contributor-readiness phase — see "What not to do yet".

## Model/prompt workflow

Every refactor PR gets a second pass from a different model or a fresh session before merge.

1. After the PR is opened and CI is green, run a fresh agent session.
2. Brief it with: the PR diff, the original file, the extracted file, the relevant `CLAUDE.md` section, and the danger-zone list from this README.
3. Ask the reviewer for: missed dependencies, stale closures, mutation paths not preserved, missing tests, missing baseline-lowering.
4. Paste the reviewer's findings into the logbook review entry verbatim, then resolve them.
5. Do not merge until the reviewer's findings are either addressed or explicitly marked "won't fix" with a reason.

A reusable reviewer prompt template lives in the logbook review entry format below.

## Exit criteria for the first two weeks

The two-week loop is successful if, at the end:

1. Two or three small extractions from `useMainWindowWorkspace.ts` are merged.
2. Each merged PR has a logbook PR entry with before/after metrics.
3. Each merged PR has a logbook review entry with at least one substantive reviewer comment.
4. The module-budget baseline has moved downward in every PR that changed LOC.
5. No danger-zone file was modified.
6. No new ESLint suppressions were introduced. `npm run check:architecture` is green.
7. The reassessment entry on day 14 states a clear next-cycle decision.

If any of these are unmet, the loop has not exited cleanly — write that up honestly in the reassessment entry before starting another cycle.

## What not to do yet

- Do not restructure `src/lib/`. That is phase 2 and depends on phase 1 being calm.
- Do not split `NoteMarkdownEditor.tsx` or `EskerraTableShell.tsx`. Coverage is not ready.
- Do not introduce a state-management library (Zustand, Redux, Jotai, etc.) or a DI container. The existing React + hooks + pure helpers model is fine.
- Do not bulk-rename or bulk-move files during a behavior-changing PR. Large import-only moves are separate PRs and must be recorded in `.git-blame-ignore-revs` when they happen.
- Do not add a `CODEOWNERS` file before the directory structure stabilizes. Premature ownership creates friction, not clarity.
- Do not add a `.github/pull_request_template.md` yet. The repository currently has one active contributor; a formal PR template is premature. The logbook PR entry in [`logbook.md`](./logbook.md) is the working substitute. A real PR template lands in a later contributor-readiness phase, after the first two-week loop closes or when a second human contributor is imminent — whichever comes first.
- Do not add `CONTRIBUTING.md` yet. Same reasoning: contributor-facing process docs are a phase-4 deliverable in the follow-up plan, not part of this loop.
- Do not write new specs for hypothetical future phases. Write specs when the work is imminent.
- Do not lower test isolation guarantees. The `restoreMocks: false` / `isolate: true` rules in [`specs/adrs/adr-vitest-desktop-test-isolation.md`](../adrs/adr-vitest-desktop-test-isolation.md) stand.
