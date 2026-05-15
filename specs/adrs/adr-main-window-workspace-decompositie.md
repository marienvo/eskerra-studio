# ADR: `useMainWindowWorkspace` decompositie baseline

## Status

Proposed — baseline capture for the phased extraction plan in `.claude/plans/useMainWindowWorkspace-decompositie.md`.

## Context

`apps/desktop/src/hooks/useMainWindowWorkspace.ts` is the desktop workspace orchestrator hook. It still owns a large amount of UI state, effect wiring, and command coordination even though a number of helper modules and bridge tests already exist.

This ADR records the starting point for the phased decomposition so later PRs can compare against a fixed snapshot instead of ad hoc recollection.

## Baseline snapshot

- File size: `4062` LOC for `apps/desktop/src/hooks/useMainWindowWorkspace.ts`.
- Direct dependency surface: `19` `import` statements, of which `10` are local relative imports and `9` are package imports.
- Related test surface: `19` desktop hook test files in `apps/desktop/src/hooks/` currently cover this orchestration area, including `2` direct `useMainWindowWorkspace.*` tests and `17` adjacent bridge/helper tests.

## Decision

1. Keep the decomposition phased and PR-sized.
2. Treat the workspace model migration as the primary ordering constraint.
3. Add a shape-level smoke test before larger refactors so the hook return contract has a cheap regression sentinel.
4. Use the existing desktop Vitest isolation rules and the current integration harness for baseline validation.

## Consequences

- The baseline is explicit and can be updated in later phases when the hook shrinks.
- The smoke test gives a low-cost guard against accidental return-shape regressions while the hook is being split.
- This ADR is documentation only; it does not change behavior.
