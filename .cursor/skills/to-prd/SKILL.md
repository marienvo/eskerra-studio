---
name: to-prd
description: Turn the current conversation context into a PRD and file it as a GitHub issue (default) or as a spec under specs/prd/ when the user prefers no issue tracker. Use when the user wants to create a PRD from the current context.
---

This skill takes the current conversation context and codebase understanding and produces a PRD. **Synthesize first:** infer modules, scope, and testing intent from the chat and repo exploration. **Do not run a broad interview.** Ask at most **one or two blocking questions** only when something essential is missing or ambiguous (e.g. target repo for the issue, or a hard scope fork).

## Where to file the output

- **Default (this repo):** open a **GitHub issue** in this repository with the PRD as the issue body (or ask the user for the target repo if work spans forks).
- **Alternative:** if the user does not use issues or asks for a repo-only artifact, write a markdown file under `specs/prd/<short-slug>.md` and mention that path in the chat.
<!-- repo-specific:start -->
Prefer `specs/` for durable product intent ([CLAUDE.md](../../../CLAUDE.md) spec discipline).
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
Prefer `specs/` for durable product intent (see [AGENTS.md](../../../AGENTS.md) and the specs discipline rule).
<!-- shared-fallback:end -->

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already.

2. Infer the major modules to build or modify from the conversation and code layout. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Record implied module boundaries and testing emphasis in the PRD body (**Implementation Decisions** / **Testing Decisions**). Only ask the user about modules or tests when the conversation truly leaves that unclear.

3. Write the PRD using the template below, then file it per **Where to file the output** above.

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want <feature>, so that <benefit>

Example (adapt actor to this product):

<!-- repo-specific:start -->
1. As a note taker, I want new captures to land in Inbox, so that I can process them later on any device that syncs the vault.
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
1. As a user, I want to complete the core workflow, so that the stated problem is solved.
<!-- shared-fallback:end -->

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.
