---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

<!-- repo-specific:start -->
For product constraints and invariants, read [CLAUDE.md](../../../CLAUDE.md) and scan [specs/](../../../specs/) (including subfolders such as `specs/performance/`) for facts the user might assume you already know — do not ask the user to restate what is written there.
<!-- repo-specific:end -->

<!-- shared-fallback:start -->
For product constraints and invariants, read [AGENTS.md](../../../AGENTS.md) and scan [specs/](../../../specs/) for facts the user might assume you already know — do not ask the user to restate what is written there.
<!-- shared-fallback:end -->
