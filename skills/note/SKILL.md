---
name: note
description: "Use when capturing a customer signal, product observation, or evidence worth remembering. Quick-capture into the shared product brain."
---

# pm:note

## Purpose

Capture one durable product observation into the shared evidence pool — lightweight by design, so downstream research and grooming can synthesize it later. Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions, and `${CLAUDE_PLUGIN_ROOT}/references/capture.md` for the `writeNote` contract, tag inference, privacy routing, and capture-vs-ingest-vs-research routing. Extract the observation (ask "What did you observe?" if none is given), infer source and tags, resolve both `{pm_dir}` and `{pm_state_dir}`, then write it with `writeNote`.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.
Read `${CLAUDE_PLUGIN_ROOT}/references/evidence-system.md` for the shared evidence identity, privacy, and ledger contract.

## Iron Law

**NEVER LOSE THE ORIGINAL PRODUCT SIGNAL.**

## When NOT to use

Do not use for bulk imports (`pm:ingest`), research synthesis (`pm:research`), chores (`pm:task`), or regressions (`pm:bug`).

**Workflow:** `note` | **Telemetry steps:** `capture`, `enrich`

## Hard rules

- Never let a product signal die in chat — write it before the conversation moves on.
- Public/internal notes publish to the monthly reader artifact in one pass. Pending customer-sensitive/restricted originals stay under `{pm_state_dir}` with mode `0600` and have no reader-artifact binding.
- Publish a sensitive note only through `publishReviewedNote` after sanitization and explicit PII review. The private original is never rewritten or copied into the monthly note.
- Enrichment of a published note appends to the saved entry; the original is never rewritten or lost, and `note_count`/`digested_through` are left untouched. Do not append pending private text to a reader artifact as enrichment.
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
- **"The warning is enough; I can bind the pending note."** Stop; pending sensitive evidence must have zero artifact paths. Use the sanitized review path first.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is too small to save." | Small signals compound into useful evidence later. |
| "Tags can replace the source." | Provenance and the original observation serve different purposes. |
| "The customer wording is probably safe." | Store it privately while review is pending; only reviewed sanitized text may be published. |

## Before Marking Done

- [ ] The original observation, source, and routing tags were saved atomically in the correct public or private lane.
- [ ] A pending sensitive note has no reader artifact or `artifact_paths` binding; a published sensitive note contains only reviewed sanitized text.
- [ ] The capture has an Evidence-ID and the shared provenance ledger validates.
- [ ] The user confirmed the saved result and saw the appropriate review, enrichment, or synthesis next action.
