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

## Baseline — 2026-05-14 — cycle 1

**Branch:** `cleaning-things-up`
**Commit:** `1290736b`

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

Candidates considered for extraction this cycle: TODO — to be filled in after the day 2–4 audit step. Do not pre-commit before reading the code.

- TODO — candidate 1: one-line rationale, explicit confirmation outside danger zones.
- TODO — candidate 2.
- TODO — candidate 3.

Selected candidate: TODO — pick after the audit.

Reason for selection: TODO — must state how it avoids cache, persistence, watcher, and editor-save behavior.
