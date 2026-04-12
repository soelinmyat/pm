---
name: refresh
description: "Use when updating existing research to backfill gaps from newly added tools or refresh stale data. Audits pm/ files for staleness and missing sections, patches without losing existing content. Triggers on 'refresh,' 'update research,' 'what's stale,' 'backfill.'"
---

# pm:refresh

Re-run data collection on existing research to backfill gaps from newly added tools and update stale data — without losing user-written content or burning unnecessary API budget.

## Workflow Loading

Load the refresh workflow steps using the step loader:

```
const { loadWorkflow, buildPrompt } = require('${CLAUDE_PLUGIN_ROOT}/scripts/step-loader');
const steps = loadWorkflow('refresh', pmDir, '${CLAUDE_PLUGIN_ROOT}');
const workflowPrompt = buildPrompt(steps);
```

The step loader reads step files from `${CLAUDE_PLUGIN_ROOT}/skills/refresh/steps/` (defaults) with user overrides from `.pm/workflows/refresh/` (if any). Steps are sorted by order and concatenated into the workflow prompt.

Execute the loaded workflow steps in order. Each step contains its own instructions. Mode routing (Step 1) determines which subsequent steps run — `consolidate` mode skips Steps 2-3 and jumps directly to Step 4.

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:refresh`:
- run start / run end
- one step span for `audit`
- one step span for `cost-guardrail`
- one step span per executed refresh batch (`seo-refresh`, `landscape-refresh`, `topic-refresh`, `competitor-refresh`)
- one step span for synthesis updates

## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

## References

The following reference files provide detailed guidance for specific refresh phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/mode-routing.md` | Mode selection table and domain discovery logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/staleness-thresholds.md` | Threshold values, date handling, and section detection rules |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/origin-rules.md` | Topic research origin rules (`external`, `internal`, `mixed`) |

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message.
