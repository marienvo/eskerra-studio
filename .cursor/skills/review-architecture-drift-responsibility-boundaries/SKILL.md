---
name: review-architecture-drift-responsibility-boundaries
description: >-
  Reviews code for creeping responsibilities, unclear ownership, cross-layer
  leakage, god modules, and architectural drift. Use when changes touch
  orchestration, filesystem adapters, editor integration, Today Hub, workspace
  switching, persistence, sync, or shared core packages.
---

# Architecture Drift & Responsibility Boundaries

This skill prioritizes keeping responsibilities explicit, local, and reviewable. It should flag code that works today but makes the system harder to reason about tomorrow.

This skill prefers clear, slightly imperfect structure over clever abstractions that hide responsibility.

## Why it exists

This codebase has several high-leverage seams: editor runtime, vault filesystem, persistence, sync, Today Hub, workspace switching, and shared core logic. Bugs become harder to diagnose when one module quietly gains too many responsibilities or when product UI, core logic, and platform adapters start knowing too much about each other.

## Core principle

A change should make ownership clearer, not blurrier.

**A module should not need to change for unrelated features.**

If a module gains responsibility, the code should make clear:

- what responsibility moved or was added
- why this module is the right owner
- which layer remains authoritative
- whether this creates a new dependency direction

## Failure modes

- God modules accumulating orchestration, business logic, persistence, and UI wiring
- Product UI directly handling filesystem, serialization, or sync details
- Core packages depending on desktop/mobile-specific concepts
- Adapter logic leaking into domain logic
- Multiple modules owning the same decision
- Callback chains hiding control flow
- “Small convenience” helpers becoming cross-layer backdoors
- Feature code bypassing established seams because it is faster locally

## Severity guidelines

Focus on changes that increase long-term coupling or make correctness harder to verify.

### High severity

- A module starts owning multiple unrelated concerns without clear justification
- UI code writes directly to persistence or sync paths without going through the established seam
- Core logic imports platform-specific APIs or concepts
- Two modules can now make conflicting decisions about the same state or file
- A shortcut bypasses validation, serialization, or safety checks

### Medium severity

- A helper is placed in a layer where it pulls dependencies in the wrong direction
- A callback or prop chain makes data flow difficult to trace
- Logic is duplicated across layers with slight differences
- A module name no longer describes what the module actually does

### Low severity

- Minor local duplication that avoids premature abstraction
- Temporary glue code that is clearly isolated and documented
- Small colocated logic that improves readability without crossing layer boundaries

### Red flags

- “Just pass one more callback”
- “This is only needed here for now”
- UI code importing filesystem/write/sync utilities directly
- Core package importing app-specific types
- A module importing both high-level orchestration logic and low-level platform details
- A hook that both decides policy and performs persistence
- A module that must be edited for unrelated features
- A helper whose name hides side effects
- A module exposing internal details that other modules start depending on

## What to check

- Responsibility ownership:
  - What is this module responsible for?
  - Did this change add a new responsibility?
  - Is that responsibility cohesive with the existing module?

- Scope of impact:
  - Does this change affect only this module, or multiple parts of the system?
  - Does it introduce new coupling between previously independent areas?

- Layer boundaries:
  - Does UI code stay UI-focused?
  - Does core logic remain platform-independent?
  - Do adapters isolate platform-specific behavior?
  - Are dependencies flowing in the intended direction?

- Established seams:
  - Does the change use the existing orchestration or persistence path?
  - Does this change introduce a new path that bypasses existing orchestration or persistence flows?
  - Does it bypass validation, serialization, sync, or conflict handling?
  - If it introduces a new seam, is the reason explicit?

- Data and control flow:
  - Can a reviewer trace where a decision is made?
  - Are there multiple authorities for the same decision?
  - Are callbacks hiding important ordering or ownership?

- Abstractions:
  - Does the abstraction reduce coupling, or only hide it?
  - Does a helper have surprising side effects?
  - Would the abstraction still make sense if used twice?

- Future change cost:
  - Would an unrelated feature now need to touch this module?
  - Does this make testing easier or harder?
  - Does this make debugging more local or more global?

## When to ignore

- Simple local code that is intentionally not abstracted yet
- Duplication that is clearer and safer than a premature abstraction
- UI orchestration that is purely presentational
- Temporary migration glue with a clear removal path
- Test-only helpers that do not leak into production architecture
- Pragmatic shortcuts that are clearly local, bounded, and do not introduce new cross-layer dependencies

## Examples (bad)

```ts
// ❌ Cross-layer leakage via convenience
import { writeNote } from "@/core/persistence";

export const useSaveShortcut = () => {
  return async () => {
    const content = getEditorContent();
    await writeNote(activePath, content); // bypasses orchestration
  };
};

// ❌ UI component directly owns persistence details
const NoteToolbar = ({ activePath, markdown }) => {
  const save = async () => {
    await writeTextFile(activePath, markdown);
    await syncToRemote(activePath);
  };
  return <button onClick={save}>Save</button>;
};

// ❌ Core logic imports desktop-specific APIs
import { invoke } from "@tauri-apps/api/core";

export const readVaultNote = async (path: string) => {
  return invoke<string>("read_note", { path });
};

// ❌ Helper hides side effects
export const normalizeNote = async (path: string) => {
  const markdown = await readNote(path);
  const normalized = markdown.trim();
  await writeNote(path, normalized);
  return normalized;
};

// ❌ Hook mixes policy, orchestration, persistence, and UI state
export const useWorkspaceSwitch = () => {
  const [isBusy, setIsBusy] = useState(false);
  const switchWorkspace = async (nextWorkspaceId: string) => {
    setIsBusy(true);
    const markdown = editorRef.current?.getMarkdown() ?? "";
    await writeNote(activePath, markdown);
    await updateWorkspaceStore(nextWorkspaceId);
    await syncPlaylist();
    setActiveWorkspace(nextWorkspaceId);
    setIsBusy(false);
  };
  return { isBusy, switchWorkspace };
};

// ❌ Internal detail leak becomes dependency
export const getVaultPath = () => internalVaultPath;

// elsewhere — now multiple modules depend on this
const path = getVaultPath();
```

## Examples (good)

```ts
// ✅ UI delegates persistence to an explicit seam
const NoteToolbar = ({ onSave }) => {
  return <button onClick={onSave}>Save</button>;
};

// ✅ UI calls orchestration, not persistence
export const useSaveShortcut = ({ saveNote }) => {
  return async () => {
    await saveNote();
  };
};

// ✅ Core depends on an interface, not a platform
export type VaultFilesystem = {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
};

export const readVaultNote = async (
  filesystem: VaultFilesystem,
  path: string,
) => {
  return filesystem.readText(path);
};

// ✅ Side effect is explicit in the name and scope
export const trimAndWriteNote = async (
  filesystem: VaultFilesystem,
  path: string,
  markdown: string,
) => {
  const trimmed = markdown.trim();
  await filesystem.writeText(path, trimmed);
  return trimmed;
};

// ✅ Orchestration stays behind a clear boundary
export const switchWorkspace = async ({
  currentWorkspaceId,
  nextWorkspaceId,
  flushCurrentEditor,
  persistWorkspaceState,
  loadWorkspaceState,
}: {
  currentWorkspaceId: string;
  nextWorkspaceId: string;
  flushCurrentEditor: () => Promise<void>;
  persistWorkspaceState: (workspaceId: string) => Promise<void>;
  loadWorkspaceState: (workspaceId: string) => Promise<void>;
}) => {
  await flushCurrentEditor();
  await persistWorkspaceState(currentWorkspaceId);
  await loadWorkspaceState(nextWorkspaceId);
};
```
