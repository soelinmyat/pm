---
name: research
description: "Use when doing industry landscape analysis, competitive intelligence, competitor profiling, market research, keyword analysis, or building the product knowledge base. Three modes: landscape (industry overview, pre-strategy), competitors (deep profiling, post-strategy), topic (targeted investigation). Triggers on 'research,' 'landscape,' 'competitor,' 'competitive analysis,' 'market research,' 'keyword research,' 'industry overview.'"
---

# pm:research

Build and maintain the product knowledge base. Research gates strategy and grooming — without it, positioning is guesswork.

## Workflow Loading

Load the research workflow steps using the step loader:

```
const { loadWorkflow, buildPrompt } = require('${CLAUDE_PLUGIN_ROOT}/scripts/step-loader');
const steps = loadWorkflow('research', pmDir, '${CLAUDE_PLUGIN_ROOT}');
const workflowPrompt = buildPrompt(steps);
```

The step loader reads step files from `${CLAUDE_PLUGIN_ROOT}/skills/research/steps/` (defaults) with user overrides from `.pm/workflows/research/` (if any). Steps are sorted by order and concatenated into the workflow prompt.

Execute the loaded workflow steps in order. Each step contains its own instructions. Only one research mode (landscape, competitor, or topic) runs per invocation — see Step 2 (Mode Routing).

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:research`:
- run start / run end
- one step span for mode routing
- Landscape mode: `seo-market-intelligence`, `web-market-overview`, `write-landscape`
- Competitor mode: `discover-competitors`, `profile-competitors`, `synthesize`
- Topic mode: `research-topic`, `write-findings`

## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

## References

The following reference files provide detailed guidance for specific research phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` | Mode selection table and menu logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md` | 5-file competitor profiling methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/api-analysis.md` | API surface analysis methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/review-mining.md` | Review mining and sentiment analysis methodology |

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.

## Research Rules

1. Always check existing `{pm_dir}/` knowledge before running new searches. Do not duplicate what is already documented.
2. Save findings with full source URLs and access dates.
3. Update existing files in place. Never create duplicate research files for the same topic.
4. No artificial limit on search depth — follow threads until the question is genuinely answered or the sources become circular.
5. Distinguish facts (sourced) from inferences (labeled "Hypothesis:") in all output files.
6. When a source contradicts existing knowledge, note the conflict explicitly. Do not silently overwrite.
