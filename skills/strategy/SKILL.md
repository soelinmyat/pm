---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---

# pm:strategy

## Purpose

The strategy doc is the alignment filter for all grooming decisions.
Every feature idea gets evaluated against it. Without one, grooming drifts.

## Workflow Loading

Load the strategy workflow steps using the step loader:

```
const { loadWorkflow, buildPrompt } = require('${CLAUDE_PLUGIN_ROOT}/scripts/step-loader');
const steps = loadWorkflow('strategy', pmDir, '${CLAUDE_PLUGIN_ROOT}');
const workflowPrompt = buildPrompt(steps);
```

The step loader reads step files from `${CLAUDE_PLUGIN_ROOT}/skills/strategy/steps/` (defaults) with user overrides from `.pm/workflows/strategy/` (if any). Steps are sorted by order and concatenated into the workflow prompt.

Execute the loaded workflow steps in order. Each step contains its own instructions.

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:strategy`:
- run start / run end
- one step span for prerequisite detection
- one step span for the interview itself
- one step span for write/update of `{pm_dir}/strategy.md`

## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

## Interaction Rules

- **One question at a time.** Never bundle multiple questions.
- **Prefer multiple-choice** when there is a natural set of options.
- **Accept short answers.** Do not interrogate — if the user gives a brief answer, move on.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.
