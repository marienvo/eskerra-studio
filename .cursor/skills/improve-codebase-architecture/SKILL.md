---
name: improve-codebase-architecture
description: Find deepening opportunities in a codebase, informed by agent instructions, specs, and optional CONTEXT/ADR. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

<!-- repo-specific:start -->
In **this** repo, domain and invariants are anchored in [CLAUDE.md](../../../CLAUDE.md) and [specs/](../../../specs/). Optional extras: a repo-root `CONTEXT.md` and `docs/adr/` when the project adds them. For format notes see [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) and [ADR-FORMAT.md](ADR-FORMAT.md).
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
In **this** repo, domain and invariants are anchored in [AGENTS.md](../../../AGENTS.md) and [specs/](../../../specs/). Optional extras: a repo-root `CONTEXT.md` and `docs/adr/` when the project adds them. For format notes see [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) and [ADR-FORMAT.md](ADR-FORMAT.md).
<!-- shared-fallback:end -->

## Process

### 1. Explore

Read existing documentation first, in this order:

<!-- repo-specific:start -->
1. [CLAUDE.md](../../../CLAUDE.md) (architecture, vault contract, platform targets)
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
1. [AGENTS.md](../../../AGENTS.md) (architecture, platform targets, project conventions)
<!-- shared-fallback:end -->
2. Relevant files under [specs/](../../../specs/) (business rules, performance notes, non-obvious decisions)
3. If present: `CONTEXT.md` (or `CONTEXT-MAP.md` + per-area `CONTEXT.md` in a multi-context repo)
4. If present: `docs/adr/`

If optional files in steps 3–4 don't exist, proceed silently — don't flag their absence or suggest creating them upfront.

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and also in how tests would improve

**Use agent instructions and [specs/](../../../specs/) vocabulary for the product domain, and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture.** If a `CONTEXT.md` exists and defines a term, prefer that for naming.
<!-- repo-specific:start -->
If not, use vocabulary from `CLAUDE.md` — e.g. talk about "the vault filesystem seam" or "the playlist merge path," not opaque handler names. Example: if `CLAUDE.md` centers the **vault**, refer to "the module that mediates **vault** reads" rather than "the `FooService`."
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
If not, use vocabulary from `AGENTS.md` and `specs/` — name seams after domain concepts, not opaque handler names.
<!-- shared-fallback:end -->

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly (e.g. _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not yet in specs?** Add the term to the most appropriate place: a relevant `specs/` doc, and optionally `CONTEXT.md` if the team maintains one (see [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md)).
<!-- repo-specific:start -->
Also align new terms with [CLAUDE.md](../../../CLAUDE.md) when they are product-facing.
<!-- repo-specific:end -->
- **Sharpening a fuzzy term during the conversation?** Update that doc in the same pass.
- **User rejects the candidate with a load-bearing reason?** Offer a durable record: either a short addition under `specs/` or, if the project uses `docs/adr/`, an ADR (see [ADR-FORMAT.md](ADR-FORMAT.md)). Only offer when the reason would help a future explorer avoid re-suggesting the same thing — skip ephemeral or self-evident reasons.
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).
