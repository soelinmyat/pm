---
name: features
description: "Scan the codebase, extract user-facing features, and write a structured feature inventory to pm/product/features.md. Use when the user says 'features', 'feature inventory', 'scan features', 'what does this product do', or 'product capabilities'."
---

# pm:features

## Purpose

`pm:features` scans the codebase and writes a readable feature inventory to `pm/product/features.md` plus a stable, source-bound machine inventory at `pm/product/features.json`.

The primary consumer is PM itself. Groom intake reads the inventory so scope review starts from what the product already does today, not from memory.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `features` | **Telemetry steps:** `guard`, `scan`, `extract`, `calibrate`, `review`, `write`

## Iron Law

**NEVER CONFUSE CODE WITH CAPABILITY.**

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/features.md` — the executable contract for the overwrite guard, scanning pipeline, calibration bounds, user review, output format, and completion behavior.
Read and follow `${CLAUDE_PLUGIN_ROOT}/references/product-reasoning.md` for stable feature identity, reconciliation, source refs, and JSON validation.

## Hard rules

- **Never write code structure as product features.** The output describes user-facing capabilities, not routes, modules, controllers, or implementation details — those are implementation seams, not user value.
- **Don't over-split.** Subsystems are usually highlights inside a larger capability, not standalone features; over-splitting turns the file into a code map instead of a product artifact.
- **Translate, don't mirror.** Even a messy codebase gets clean capability language — internal consumers (groom) still need user-facing wording, and the inventory only compounds if the base pass is already usable.
- **User review before the final write.** Present the extracted features for review, then write `pm/product/features.md` with valid frontmatter and a completion message pointing to `pm:groom` as the next consumer.
- **Reconcile identity before review.** Preserve exact semantic keys and uniquely strong source-continuity matches; surface ambiguous merge/split/rename cases instead of minting silent replacements.

## Red Flags — Self-Check

- **"Every route deserves a feature row."** Stop and group implementation seams into user-visible outcomes.
- **"The module name is clear enough."** Use language for the capability a user can exercise.
- **"More granularity makes the inventory complete."** Keep subsystem detail as highlights unless it stands alone for users.
- **"The code proves this feature works."** Include evidence paths and confidence without claiming unverified runtime behavior.
- **"I can write before review to save time."** Ask the user to confirm the calibrated inventory first.

## When NOT to use

Do not use this skill when the user wants code explanation, architecture review, API documentation, or implementation guidance. Use direct answers, `pm:dev`, or `pm:research` instead.

## Escalation paths

- **Codebase too large or ambiguous:** "I can scan this, but the confidence will be lower than usual because the entry points are weak or scattered."
- **User wants a narrative doc, not an inventory:** "This sounds more like product documentation than a feature inventory. Want the structured inventory first, or should we write the narrative directly?"
- **No meaningful source files found:** "I couldn't find enough product code to build a reliable inventory. Want me to explain what I found, or stop here?"

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "A technical label is more precise." | The inventory exists for product decisions, so user capability language is the precise level. |
| "An exhaustive list is safer than consolidation." | Over-splitting obscures product shape and causes duplicate grooming scope. |

## Before Marking Done

- [ ] The reviewed Markdown and hash-bound v2 JSON inventory are saved with stable feature IDs, project-relative source refs, and valid contracts.
- [ ] The user confirmed capability grouping, calibration, and the final overwrite.
- [ ] Overwrite guard, scan coverage, evidence, calibration bounds, user review, and validation gates passed.
