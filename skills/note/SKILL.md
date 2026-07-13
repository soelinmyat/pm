---
name: note
description: "Use when capturing a customer signal, product observation, or evidence worth remembering. Quick-capture into the shared product brain."
---

# pm:note

## Purpose

Capture one durable product observation into the shared evidence pool in a single pass — lightweight by design, so downstream research and grooming can synthesize it later. Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions, and `${CLAUDE_PLUGIN_ROOT}/references/capture.md` for the `writeNote` contract, tag inference, and capture-vs-ingest-vs-research routing. Extract the observation (ask "What did you observe?" if none is given), infer source and tags, write it with `writeNote`, then offer optional enrichment.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER LOSE THE ORIGINAL PRODUCT SIGNAL.**

## When NOT to use

Do not use for bulk imports (`pm:ingest`), research synthesis (`pm:research`), chores (`pm:task`), or regressions (`pm:bug`).

**Workflow:** `note` | **Telemetry steps:** `capture`, `enrich`

## Hard rules

- Never let a product signal die in chat — write it before the conversation moves on.
- Enrichment appends to the saved entry; the original note is never rewritten or lost, and `note_count`/`digested_through` are left untouched.
- Bulk file/transcript imports go to `pm:ingest`, not here; synthesis into a research artifact goes to `pm:research` or a direct edit of the existing topic file.

## Escalation Paths

- **User wants to import a file or batch of evidence:** "This looks like a heavier evidence import. Want to switch to `/pm:ingest` instead of a quick note?"
- **User wants synthesis, not capture:** "If you want this folded into a research artifact right now, I can use `/pm:research` or update the existing topic file instead."
- **Observation is too vague to capture:** "I can save it, but I need one concrete observation first. What did you notice?"

## Red Flags — Self-Check

- **"I can summarize away the original wording."** Keep the observed signal intact and add enrichment separately.
- **"This batch is still one note."** Route files and multiple records to `pm:ingest`.
- **"I should synthesize the implication now."** Capture evidence first; use `pm:research` for synthesis.
- **"A direct edit is quicker."** Use `writeNote` so the append is atomic and existing notes are never overwritten.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is too small to save." | Small signals compound into useful evidence later. |
| "Tags can replace the source." | Provenance and the original observation serve different purposes. |

## Before Marking Done

- [ ] The note was appended atomically without rewriting existing entries.
- [ ] The original observation, source, and routing tags are preserved.
- [ ] The user saw confirmation and the appropriate enrichment or synthesis next action.
