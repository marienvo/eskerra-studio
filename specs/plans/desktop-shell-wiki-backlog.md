# Desktop shell and wiki links: remaining backlog

**Purpose:** Single backlog for work that is **not** done, **incomplete**, or **not yet validated** for the desktop inbox wiki-link stack and related shell seams. Implementation details for attachment hosts, playlist decoupling, workspace hooks, wiki MVP (resolve/open/create, highlights, autocomplete targets), backlinks UI, and rename maintenance **already exist in the tree**—this document tracks what remains.

**Supersedes (removed):** `plugin-readiness-masterplan.md`, `wiki-links-phased-roadmap.md`, `wiki-rename-phase.md`.

**Authoritative architecture (keep in sync with code):**

- [extension-readiness.md](../architecture/extension-readiness.md) — layers, `.eskerra` rules, editor constraints.
- [wiki-link-indexing-architecture.md](../architecture/wiki-link-indexing-architecture.md) — indexing seam, ownership, **measurement gates**.
- [desktop-editor.md](../architecture/desktop-editor.md) — inbox editor behavior and flush rules.
- [desktop-import-boundaries.md](../rules/desktop-import-boundaries.md) — target ESLint zones.

---

## Implementation baseline (context only)

The following are **landed**; do not re-scope them as greenfield work:

- Editor Tauri ban + attachment host; vault image preview URL injected from shell.
- Workspace orchestration in `useMainWindowWorkspace` (inbox restore, save flush, wiki activation, FS watch).
- Core inbox wiki resolver, navigation, rename markdown planning (`planInboxWikiLinkRenameInMarkdown`), shell plan/apply (`planVaultWikiLinkRenameMaintenance`, `applyVaultWikiLinkRenameMaintenance`).
- Backlinks list driven from **`vaultMarkdownRefs`** with debounced body loads and a debounced active note body.
- Rename flow with link maintenance, ambiguity confirmation when skipped ambiguous links exist, progress for large applies.

Remaining phases below are about **measurement**, **polish**, **scale if needed**, and **central command ownership**—not repeating the above.

---

## Phase P1 — Measurement and scale decisions (pragmatic)

**Goal:** Know whether the TypeScript-first paths are good enough on realistic large vaults before adding complexity.

1. **Document reference hardware and a reference vault profile** (file count, inbox note count, distribution of body sizes) so benchmark results are repeatable. Link or embed summaries next to any numbers in this effort.
2. **Run or script measurement** against the gates in [wiki-link-indexing-architecture.md](../architecture/wiki-link-indexing-architecture.md) for:
   - Cold start / first-screen impact of any link-related work that runs near startup (today backlinks are off the hot path; keep it that way).
   - Backlink recomputation behavior at inbox scale (full scan on refresh today).
   - Rename planning latency and **touched bytes** (logging exists; formalize pass/fail against gates or record why targets were relaxed).
3. **Decision:** If measurements fail the gates after basic optimization (batching, debounce, avoid redundant scans), introduce a **runtime-only** inverted index or incremental invalidation behind the existing shell-owned seam—not ahead of evidence.

**Non-goal:** Building a durable `.eskerra` link index or native acceleration without a benchmark-backed decision (see architecture doc).

---

## Phase P2 — Command palette and central command ownership

**Goal:** Named actions and default bindings live in **one registrar** when the palette ships; avoid siloed global shortcuts.

**Scope (minimal):**

- Single module (or small set) that enumerates commands and their handlers.
- Migrate a handful of high-risk or user-visible shortcuts first; expand over time.
- **Binding source of truth (today):** [desktop-keybindings-inventory.md](../architecture/desktop-keybindings-inventory.md) lists action ids and defaults; evolve it alongside the registrar.

**Defer:** Third-party command contributions, plugin-shaped extension points.

**Related invariant:** [extension-readiness.md](../architecture/extension-readiness.md) (keybindings and future central policy).

---

## Phase P3 — Import boundaries (ESLint ratchet)

**Goal:** Make layer violations detectable beyond the current `@tauri-apps/*` ban under `apps/desktop/src/editor/**`.

**Actions:**

- Add path-based rules (`import/no-restricted-paths`, `eslint-plugin-boundaries`, or equivalent) aligned with [desktop-import-boundaries.md](../rules/desktop-import-boundaries.md).
- Ratchet incrementally when churn allows.

---

## Phase P4 — Navigation UX: ambiguity and optional path rules (WL-6)

**Goal:** Better handling when activation would be `ambiguous`, without building a global search product.

**Likely work:**

- **Picker UI** when resolving a wiki link from the editor hits `ambiguous` (today users mainly see an error string). Rename already has a confirmation path for ambiguous *skips* during link maintenance; activation should get comparable clarity.
- **Done (subset):** Relative inline **`[label](./note.md)`** targets: resolve, editor activation, rename maintenance, backlinks, and `@eskerra/core` tests — see [desktop-editor.md](../architecture/desktop-editor.md) (Relative Markdown links). Remaining WL-6 items: wiki ambiguity picker, reference-style markdown links, optional broader path rules.

**Exclude:** Full-text search platform, fuzzy vault-wide ranking as a product.

---

## Phase P5 — Authoring polish

**Goal:** Close small authoring gaps called out in prior plans.

- **Autocomplete in the display segment** of `[[target|display]]` (today completion is intentionally target-segment only).
- Keep performance rules: cap options, prefix-first behavior for large lists; no heavy work on the first-paint path.

---

## Phase P6 — Rename and batch-write polish

**Goal:** Tighten trust and recoverability around rename maintenance (implementation exists; UX and edge cases remain).

**Candidates:**

- **Impact summary** before rename when many files/links would change—not only when ambiguous links are skipped (may be optional for small impact; product decision).
- **Retry** failed markdown applies without redoing a successful rename (today partial failure surfaces an error list).
- **Document** per-platform write strategy (atomic replace where available vs plain `writeFile`) if product needs stronger guarantees.

---

## Phase P7 — FS events and invalidation (optional)

**Goal:** Reduce unnecessary work when the vault changes outside coarse `vault-files-changed` events.

- If profiling shows **full `refreshNotes`** is too expensive at scale, consider richer event payloads or indexer-owned invalidation so not every change rescans the world.

**Trigger:** Evidence from P1 or production-like testing—not speculative optimization.

---

## Explicit non-goals

- Third-party **plugin host**, manifests, or dynamic loading.
- **iOS** or multi-mobile parity (see [platform-targets.md](../architecture/platform-targets.md)).
- **Durable `.eskerra` link caches** without explicit product ownership, retention, and user-visible behavior ([extension-readiness.md](../architecture/extension-readiness.md)).
- Replacing `App.tsx` with a full router or DI framework “big bang” refactor.

---

## Document index

| Document | Role |
|----------|------|
| [extension-readiness.md](../architecture/extension-readiness.md) | Principles, layers, `.eskerra` rules |
| [extension-readiness-pr.md](../review-checklists/extension-readiness-pr.md) | PR checklist |
| [desktop-import-boundaries.md](../rules/desktop-import-boundaries.md) | Zone model and ESLint target |
| [wiki-link-indexing-architecture.md](../architecture/wiki-link-indexing-architecture.md) | Indexing seam, benchmark gates |
