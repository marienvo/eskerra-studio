---
name: review-markdown-integrity-data-loss-prevention
description: >-
  Reviews code that reads, transforms, renders, edits, saves, syncs, or switches
  Markdown notes. Use when changes touch editor persistence, note switching,
  Today Hub serialization, frontmatter/body splitting, table serialization,
  file writes, sync logic, or any flow where user-authored Markdown could be
  silently changed or lost.
---

# Markdown Integrity & Data-Loss Prevention

This skill prioritizes preserving user-authored Markdown exactly unless a change is explicit, intentional, and reviewable.

## Safety principle

When correctness is uncertain, the system must fail closed:

- Do not write to disk
- Do not partially transform content
- Prefer surfacing an error over risking corruption

This prevents endorsing "best effort" fixes that trade safety for convenience.

## Why it exists

Markdown is the source of truth. Silent rewrites, accidental normalization, stale saves, or incorrect switching behavior can corrupt user work or cause data loss. These bugs are high-impact because they may not be noticed immediately.

## Core invariant

The editor body must remain identical to the last user-authored content after save, switch, reload, or return, unless a deliberate transformation is explicitly part of the feature.

If content changes, the code must make clear:

- why it changes
- when it changes
- whether the user can predict or review it

## Failure modes

- Silent Markdown rewrites
- Lost edits during note or workspace switching
- Saving stale editor content over newer content
- Frontmatter/body split or merge changing unrelated Markdown
- Serialization changing formatting outside its owned region
- Async save/load races
- “Helpful” normalization applied too broadly
- Multiple writers for the same note content

## Severity guidelines

Focus on bugs that can alter, lose, or overwrite user-authored content.

### High severity

- Any path that can overwrite newer user edits with stale content
- Any transformation that silently changes Markdown outside its intended scope
- Any save/load race during note or workspace switching
- Multiple persistence paths writing the same note without clear authority

### Medium severity

- Formatting normalization without a clearly bounded scope
- Parser fallback behavior that may drop or reorder content
- Derived Markdown state stored separately without synchronization guarantees

### Low severity

- Cosmetic formatting changes inside explicitly owned generated regions
- Internal editor state changes that cannot affect persisted Markdown

### Red flags

- Writing Markdown after async work without checking the active note/workspace is still the same
- Writing Markdown derived from UI state instead of the last known persisted or editor-authored source
- Rebuilding a whole document to update one section
- Parsing Markdown into a lossy structure and serializing it back
- Normalizing content on read instead of only on explicit write
- Catching parser errors and continuing with partial output

## What to check

- Persistence paths:
  - Who is allowed to write the Markdown file?
  - Is there exactly one authoritative save path?
  - Can stale content overwrite newer editor content?

- Note / workspace switching:
  - Are pending edits flushed before switching?
  - Can in-flight saves or loads apply to the wrong note?
  - Is there protection against switching away and back quickly?
  - Rapid switching scenarios:
    - What happens if the user switches notes multiple times within milliseconds?
    - Can delayed operations apply to an outdated note?

- Transformations:
  - Is the transformed region clearly bounded?
  - Does the transformation preserve all unrelated Markdown exactly (byte-for-byte or text-for-text), unless explicitly documented otherwise?
  - Is the transformation explicit rather than accidental?

- Frontmatter handling:
  - Does splitting and merging preserve the body exactly?
  - Are duplicate or invalid keys handled safely?
  - Does parser failure avoid writing corrupted output?

- Serialization:
  - Is serialization deterministic?
  - Does it only affect owned/generated structures?
  - Are unsupported shapes preserved or rejected safely?

- Error handling:
  - Does failure prevent unsafe writes?
  - Are partial results prevented from reaching disk?
  - Is the user shown an explicit conflict or error where needed?

## When to ignore

- Intentional, documented formatting inside explicitly owned regions
- Preview-only rendering that cannot affect persisted Markdown
- Read-only parsing used only for display
- Test fixtures where normalization is the thing being tested

## Examples (bad)

```ts
// ❌ Rewrites the whole document to update one section
const updatedMarkdown = serializeMarkdown(parseMarkdown(markdown));
await writeNote(path, updatedMarkdown);

// ❌ Async save can overwrite newer content
const saveNote = async () => {
  const body = editorBody;

  await delay(100);

  await writeNote(activePath, body);
};

// ❌ Parser failure falls back to empty content
const parsed = parseFrontmatter(markdown) ?? { frontmatter: {}, body: "" };
await writeNote(path, mergeFrontmatter(parsed));

// ❌ Transformation is too broad
const normalized = markdown.replace(/\s+$/gm, "");
await writeNote(path, normalized);

// ❌ Uses derived UI state instead of source
const nextMarkdown = buildMarkdownFromUI(editorState);
await writeNote(path, nextMarkdown);
```

## Examples (good)

```ts
// ✅ Update only the owned region
const updatedMarkdown = replaceTodaySection(markdown, nextTodaySection);

// ✅ Guard UI-driven async save before writing
let currentSaveRequestId = 0;

const saveNote = async (path, body) => {
  const requestId = ++currentSaveRequestId;
  const savePath = path;

  await delay(100);

  if (requestId !== currentSaveRequestId || savePath !== getActiveNotePath()) {
    return;
  }

  await writeNote(savePath, body);
  markSaved(savePath);
};

// ✅ Fail closed on unsafe parse
const result = parseFrontmatter(markdown);

if (!result.ok) {
  showParseError(result.error);
  return;
}

await writeNote(path, mergeFrontmatter(result.value));

// ✅ Fail closed on uncertainty
const parsed = parseMarkdown(markdown);

if (!parsed.ok) {
  logError(parsed.error);
  return; // do not write
}

// ✅ Preserve body exactly
const { frontmatter, body } = splitFrontmatter(markdown);
const nextMarkdown = mergeFrontmatter(updateFrontmatter(frontmatter), body);
```
