---
name: features
description: "Scan the codebase, extract user-facing features, and write a structured feature inventory to pm/product/features.md. Use when the user says 'features', 'feature inventory', 'scan features', 'what does this product do', or 'product capabilities'."
---

# pm:features

## Purpose

`pm:features` scans the codebase and writes a structured feature inventory to `pm/product/features.md`.

The primary consumer is PM itself. Groom intake reads the inventory so scope review starts from what the product already does today, not from memory.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `features`

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/features.md` — the executable contract for the overwrite guard, scanning pipeline, calibration bounds, user review, output format, and completion behavior.

## Hard rules

- **Never write code structure as product features.** The output describes user-facing capabilities, not routes, modules, controllers, or implementation details — those are implementation seams, not user value.
- **Don't over-split.** Subsystems are usually highlights inside a larger capability, not standalone features; over-splitting turns the file into a code map instead of a product artifact.
- **Translate, don't mirror.** Even a messy codebase gets clean capability language — internal consumers (groom) still need user-facing wording, and the inventory only compounds if the base pass is already usable.
- **User review before the final write.** Present the extracted features for review, then write `pm/product/features.md` with valid frontmatter and a completion message pointing to `pm:groom` as the next consumer.

## When NOT to use

Do not use this skill when the user wants code explanation, architecture review, API documentation, or implementation guidance. Use direct answers, `pm:dev`, or `pm:research` instead.

## Escalation paths

- **Codebase too large or ambiguous:** "I can scan this, but the confidence will be lower than usual because the entry points are weak or scattered."
- **User wants a narrative doc, not an inventory:** "This sounds more like product documentation than a feature inventory. Want the structured inventory first, or should we write the narrative directly?"
- **No meaningful source files found:** "I couldn't find enough product code to build a reliable inventory. Want me to explain what I found, or stop here?"
