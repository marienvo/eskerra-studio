---
name: ubiquitous-language
description: Extract a DDD-style ubiquitous language glossary from the current conversation, flagging ambiguities and proposing canonical terms. Writes to specs/ubiquitous-language.md in this repo. Use when the user wants to define domain terms, build a glossary, harden terminology, create a ubiquitous language, or mentions "domain model" or "DDD".
disable-model-invocation: true
---

# Ubiquitous Language

Extract and formalize domain terminology from the current conversation into a consistent glossary. **In this repository**, always write the file to:

**`specs/ubiquitous-language.md`**

That keeps the glossary next to other non-obvious product facts (see the specs discipline rule).
<!-- repo-specific:start -->
See also [CLAUDE.md](../../../CLAUDE.md) for product vocabulary.
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
See also [AGENTS.md](../../../AGENTS.md) for product vocabulary.
<!-- shared-fallback:end -->
If the file already exists, update it in place; do not scatter `UBIQUITOUS_LANGUAGE.md` in the cwd.

## Process

1. **Scan the conversation** for domain-relevant nouns, verbs, and concepts
2. **Identify problems**:
   - Same word used for different concepts (ambiguity)
   - Different words used for the same concept (synonyms)
   - Vague or overloaded terms
3. **Propose a canonical glossary** with opinionated term choices aligned with this product’s domain.
<!-- repo-specific:start -->
Use vocabulary from [CLAUDE.md](../../../CLAUDE.md) (Eskerra vault, notes, podcast feeds, playlist, etc.) when applicable.
<!-- repo-specific:end -->
<!-- shared-fallback:start -->
Use vocabulary from [AGENTS.md](../../../AGENTS.md) and existing `specs/` when applicable.
<!-- shared-fallback:end -->
4. **Write to `specs/ubiquitous-language.md`** using the format below (create the file or merge into it)
5. **Output a summary** inline in the conversation

## Output Format

Use this structure in `specs/ubiquitous-language.md`:

```md
# Ubiquitous Language

## Vault and storage

| Term     | Definition                                                                 | Aliases to avoid  |
| -------- | -------------------------------------------------------------------------- | ----------------- |
| **Vault** | The user-chosen root directory that holds notes and podcast data, possibly synced (e.g. Syncthing) | Folder, workspace |
| **Inbox** | The folder of user `.md` notes; directory listing is source of truth      | —                 |

## Podcasts and playback

| Term         | Definition                                                                       | Aliases to avoid   |
| ------------ | -------------------------------------------------------------------------------- | ------------------ |
| **Feed**     | A podcast source (e.g. RSS) represented in a `General/` markdown feed file        | Channel (ambiguous) |
| **Episode**  | A single playable item from a feed, often cached as a `📻` note in **General**     | Show, file         |
| **Playlist** | Ordered playback list with merge rules when multiple devices write state        | Queue (ambiguous)  |

## Relationships

- A **Feed** has many **Episodes**
- **Playlist** state merges across devices using `controlRevision` and timestamps
<!-- repo-specific:start -->
 per [CLAUDE.md](../../../CLAUDE.md)
<!-- repo-specific:end -->

## Example dialogue

> **Dev:** "When the user pauses on mobile, do we still bump **controlRevision** in **playlist** state?"
> **Domain expert:** "Only if that device wins the merge — see higher **controlRevision**, then **updatedAt**; R2 is authoritative when configured."
> **Dev:** "So two offline edits can conflict until sync?"
> **Domain expert:** "Right. The **Vault** is always the same tree; the conflict is about who owns playback order, not the files on disk."

## Flagged ambiguities

- "note" was used for both a Markdown file in **Inbox** and an episode cache file — recommend **Episode** for podcast cache to avoid clashing with **Inbox** notes.
```

(Replace section headings and terms with what the *current* conversation actually needs; the table above is only an illustration — adapt to your product domain.)

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously in the conversation, call it out in the "Flagged ambiguities" section with a clear recommendation.
- **Only include terms relevant for domain experts.** Skip the names of modules or classes unless they have meaning in the domain language.
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include domain terms.** Skip generic programming concepts (array, function, endpoint) unless they have domain-specific meaning.
- **Group terms into multiple tables** when natural clusters emerge. Each group gets its own heading and table.
- **Write an example dialogue.** A short conversation (3-5 exchanges) that demonstrates how the terms interact. Align examples with this product’s domain when applicable.

## Re-running

When invoked again in the same conversation:

1. Read the existing `specs/ubiquitous-language.md` if it exists
2. Incorporate any new terms from subsequent discussion
3. Update definitions if understanding has evolved
4. Re-flag any new ambiguities
5. Rewrite the example dialogue to incorporate new terms
