# Optional domain context file (`CONTEXT.md`)

**This repository** primarily documents product truth in agent instructions and [`specs/`](../../../specs/). Use that vocabulary first when naming seams and modules.
<!-- repo-specific:start -->
Canonical product doc: [`CLAUDE.md`](../../../CLAUDE.md).
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
Canonical product doc: [`AGENTS.md`](../../../AGENTS.md).
<!-- shared-fallback:end -->

If you add a **repository-root** `CONTEXT.md` (or `docs/domain/CONTEXT.md`), use it for terms that are stable domain concepts not fully spelled out elsewhere. Suggested structure:

- Short intro: what bounded area this file covers.
- **Terms**: tables of canonical names, one-line definitions, and aliases to avoid.
- **Relationships** between terms where it prevents ambiguity.
- **Example dialogue** (optional) showing precise use of terms.

Do not duplicate large sections of the canonical agent doc — link or reference instead, and add only new glossary depth.
<!-- repo-specific:start -->
Primary link target: [`CLAUDE.md`](../../../CLAUDE.md).
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
Primary link target: [`AGENTS.md`](../../../AGENTS.md).
<!-- shared-fallback:end -->
