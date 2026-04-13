---
name: research
description: "Use when doing market research, competitive intelligence, or building the product knowledge base. Three modes: landscape, competitors, topic."
---

# pm:research

Build and maintain the product knowledge base. Research gates strategy and grooming — without it, positioning is guesswork.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, telemetry, custom instructions, and interaction pacing.

**Workflow:** `research` | **Telemetry steps:** `mode-routing`, `seo-market-intelligence`, `web-market-overview`, `write-landscape`, `discover-competitors`, `profile-competitors`, `synthesize`, `research-topic`, `write-findings`.

Execute the loaded workflow steps in order. Only one research mode (landscape, competitor, or topic) runs per invocation — see Step 2 (Mode Routing).

## References

The following reference files provide detailed guidance for specific research phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` | Mode selection table and menu logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md` | 5-file competitor profiling methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/api-analysis.md` | API surface analysis methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/review-mining.md` | Review mining and sentiment analysis methodology |

## Research Rules

1. Always check existing `{pm_dir}/` knowledge before running new searches. Do not duplicate what is already documented.
2. Save findings with full source URLs and access dates.
3. Update existing files in place. Never create duplicate research files for the same topic.
4. No artificial limit on search depth — follow threads until the question is genuinely answered or the sources become circular.
5. Distinguish facts (sourced) from inferences (labeled "Hypothesis:") in all output files.
6. When a source contradicts existing knowledge, note the conflict explicitly. Do not silently overwrite.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Web search is enough, skip SEO tools" | Web search shows what's loud. SEO shows what users actually search for. |
| "One source confirms it" | One source is an anecdote. Three sources are a finding. |
| "Market data isn't needed for this feature" | You don't know if market data is needed until you look. The absence of data is a finding. |
| "Existing research covers this" | Check the date. Research older than 90 days is a starting point, not an answer. |
