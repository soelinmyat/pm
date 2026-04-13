---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---

# pm:strategy

## Purpose

The strategy doc is the alignment filter for all grooming decisions.
Every feature idea gets evaluated against it. Without one, grooming drifts.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, telemetry, custom instructions, and interaction pacing.

**Workflow:** `strategy` | **Telemetry steps:** `prerequisite-detection`, `interview`, `write-strategy`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

## Interaction Pacing

- **Prefer multiple-choice** when there is a natural set of options.
- **Accept short answers.** Do not interrogate — if the user gives a brief answer, move on.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.
