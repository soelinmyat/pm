---
name: Route Insights
order: 4
description: Route synthesized findings to the correct insight domains using the insight-routing protocol
---

## Route Findings to Insight Topics

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md`.
Pass all evidence file paths written or updated during Step 3 (Synthesize) and
their key findings as input. Batch all evidence together for one
routing pass (not one per file).

If no insight domains exist and no `{pm_dir}/strategy.md` exists, skip.
