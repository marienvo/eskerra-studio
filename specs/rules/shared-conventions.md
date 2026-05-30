# Shared AI conventions (sibling repos)

**Canonical repo:** `notebox` (this repository).

**Sibling target:** `eskerra-go` (Android/Kotlin PoC) and any future repos listed in the manifest.

## What is shared

Synced from notebox to siblings via [`scripts/sync-shared-conventions.sh`](../../scripts/sync-shared-conventions.sh):

| Category | Source in notebox | Target path in sibling |
|----------|-------------------|------------------------|
| Cursor rules | `.cursor/rules/shared/*.mdc` | `.cursor/rules/{language,quality,specs,testing}.mdc` |
| Agent skills | `.cursor/skills/{tdd,to-prd,...}` | `.cursor/skills/` (same names) |
| Claude hook | `.claude/hooks/block-dangerous-git.sh` | same |
| Claude settings | `scripts/shared-conventions/claude-settings.json` | `.claude/settings.json` |
| Editor defaults | `scripts/shared-conventions/editorconfig` | `.editorconfig` |

Allowlist: [`scripts/shared-conventions.manifest.json`](../../scripts/shared-conventions.manifest.json).

Skills in notebox may wrap repo-only paragraphs in `<!-- repo-specific:start/end -->` and generic fallbacks in `<!-- shared-fallback:start/end -->`. The sync script strips repo-specific blocks and fallback marker lines in siblings.

## What stays repo-specific

**notebox only:** desktop/mobile UI rules, Storybook, design system, Vitest desktop isolation, ESLint/module budgets, `performance.mdc`, `languages.mdc`, repo-local review skills.

**eskerra-go only:** `.cursor/rules/project-conventions.mdc`, `AGENTS.md` project section, `specs/architecture/poc-contract.md`, Gradle/git-hook setup without npm.

## Agent instruction files

- **Canonical name:** `AGENTS.md` in each repo (full instructions in notebox; project-specific + sync pointer in siblings).
- **Pointers:** `CLAUDE.md`, `CODEX.md` → "See AGENTS.md".

## How to sync

From notebox:

```bash
./scripts/sync-shared-conventions.sh /path/to/eskerra-go
./scripts/sync-shared-conventions.sh --check /path/to/eskerra-go   # dry-run diff (no writes to target)
```

Synced hook scripts keep the source file mode (e.g. `block-dangerous-git.sh` stays executable).

Do **not** edit synced files in the target repo. Change the canonical file in notebox (or `.cursor/rules/shared/` for rules), then re-run the script.

## Git guardrails

| Repo | Mechanism |
|------|-----------|
| notebox | Husky `pre-commit` (no direct commits to `main`) + Claude PreToolUse hook |
| eskerra-go | `git config core.hooksPath scripts/githooks` + same Claude hook (synced) |

## Editing shared Cursor rules in notebox

Source files live under [`.cursor/rules/shared/`](../../.cursor/rules/shared/). Top-level `.cursor/rules/{language,quality,specs,testing}.mdc` are symlinks into `shared/` so Cursor loads them here too.
