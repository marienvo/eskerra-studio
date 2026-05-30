---
name: zoom-out
description: Tell the agent to zoom out and give broader context or a higher-level perspective. Use when you're unfamiliar with a section of code or need to understand how it fits into the bigger picture.
disable-model-invocation: true
---

I don't know this area of code well. Go up a layer of abstraction. Give me a map of all the relevant modules and callers.

<!-- repo-specific:start -->
Start from [CLAUDE.md](../../../CLAUDE.md) and `packages/eskerra-core` / `apps/desktop` or `apps/mobile` layout when the change crosses layers.
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
Start from [AGENTS.md](../../../AGENTS.md) and the repo’s module layout when the change crosses layers.
<!-- shared-fallback:end -->
