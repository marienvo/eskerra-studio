# Agent skills (canonical)

**Source of truth:** this directory (`.cursor/skills`).  
`.claude/skills` is a **symlink** here so Claude Code and Cursor load the same
files. **Edit only this tree**; do not restore a second copy under `.claude/`.

Also in this repo (not from upstream):

- `desktop-performance-debug-loop`
- `review-state-consistency-closure-safety`
- `review-markdown-integrity-data-loss-prevention`
- `review-architecture-drift-responsibility-boundaries`

**Review skills:** use the `review-` prefix on the directory and YAML `name` field (e.g. `review-state-consistency-closure-safety`).

Imported from `mattpocock/skills`:

- `design-an-interface`
- `request-refactor-plan`
- `tdd`
- `zoom-out`
- `improve-codebase-architecture`
- `git-guardrails-claude-code`
- `grill-me`
- `to-prd`
- `ubiquitous-language`

Source: https://github.com/mattpocock/skills/tree/main

The imported skills are covered by the upstream MIT license in
`mattpocock-skills-LICENSE`.

Codex CLI and Gemini do not have repo-local skill loading configured here, so
this repo does not add tool-specific skill shims for them.

## Local deltas vs mattpocock upstream

When syncing from [mattpocock/skills](https://github.com/mattpocock/skills), merge carefully: the following skills carry **Eskerra-specific** edits (paths, defaults, or tooling scope). Prefer keeping our paragraphs and adding upstream changes around them.

| Skill | What we changed |
| ----- | ---------------- |
| `to-prd` | Synthesis-first PRD flow; GitHub issue default; minimal blocking questions only |
| `git-guardrails-claude-code` | Claude Code `PreToolUse` scope vs Cursor; note that this repo already has `.claude` hooks |
| `request-refactor-plan` | Explicit default: GitHub issue unless user wants `specs/` |
| `tdd` | Monorepo commands + pointer to `.cursor/rules` for desktop Vitest |
| `design-an-interface` | L1/L2/L3 and `VaultFilesystem` (verify on merge) |
| `zoom-out` | CLAUDE + package paths (verify on merge) |
| `improve-codebase-architecture` | CLAUDE, `specs/`, vault vocabulary (verify on merge) |
| `ubiquitous-language` | Output path `specs/ubiquitous-language.md` (verify on merge) |
| `grill-me` | Read `specs/` before restating invariants |

`desktop-performance-debug-loop` is **repo-local only** (not from upstream).
