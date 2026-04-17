---
name: features
description: "Scan the codebase, extract user-facing features via a 3-pass pipeline, and write a structured feature inventory to pm/product/features.md. Use when the user says 'features', 'feature inventory', 'scan features', 'what does this product do', or 'product capabilities'."
---

# pm:features

## Purpose

`pm:features` scans the codebase and writes a structured feature inventory to `pm/product/features.md`.

The primary consumer is PM itself. Groom intake reads the inventory so scope review starts from what the product already does today, not from memory.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER WRITE CODE STRUCTURE AS PRODUCT FEATURES.** The output must describe user-facing capabilities, not routes, modules, controllers, or implementation details.

## When NOT to use

Do not use this skill when the user wants code explanation, architecture review, API documentation, or implementation guidance. Use direct answers, `pm:dev`, or `pm:research` instead.

**Workflow:** `features` | **Telemetry steps:** `overwrite-guard`, `scan`, `review`, `write`

**Steps:** Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/features.md`. Treat that reference as the executable contract for the overwrite guard, scanning pipeline, user review, output format, and completion behavior.

## Red Flags — Self-Check

- **"The route names are good enough — I'll just list them."** Routes are implementation clues, not user-facing features.
- **"I should preserve every subsystem as its own feature."** Subsystems are often highlights inside a larger capability, not standalone product features.
- **"This inventory should explain the architecture."** The point is product understanding, not technical orientation.
- **"If the codebase is messy, the output should be equally messy."** The skill exists to translate implementation into clean capability language.

## Escalation Paths

- **Codebase too large or ambiguous:** "I can scan this, but the confidence will be lower than usual because the entry points are weak or scattered."
- **User wants a narrative doc, not an inventory:** "This sounds more like product documentation than a feature inventory. Want the structured inventory first, or should we write the narrative directly?"
- **No meaningful source files found:** "I couldn't find enough product code to build a reliable inventory. Want me to explain what I found, or stop here?"

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Controllers are basically features" | They are implementation seams, not user value. |
| "More features means a better inventory" | Over-splitting turns the file into a code map, not a product artifact. |
| "The output can stay technical because PM uses it internally" | Internal consumers still need user-facing capability language. |
| "If the user can edit later, first pass quality doesn't matter" | The inventory compounds only if the base pass is already usable. |

## Before Marking Done

- [ ] `pm/product/features.md` written with valid frontmatter
- [ ] User review completed before final write
- [ ] Output describes product capabilities in plain language
- [ ] Completion message points the user to `pm:groom` as the next consumer
