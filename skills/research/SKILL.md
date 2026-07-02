---
name: research
description: "Use when doing market research, competitive intelligence, or building the product knowledge base. Use when the user says 'research this', 'analyze the market', 'who are our competitors', 'what does the landscape look like', 'competitive analysis', 'research {topic}', 'what's the market for', 'profile competitors', 'update landscape', 'dig into {topic}', or wants durable research artifacts saved to the knowledge base. Three modes: landscape, competitors, topic. Outputs persistent research files — not quick answers."
---

# pm:research

## Purpose

Build and maintain the product knowledge base with durable, sourced research artifacts. Research gates strategy and grooming — without it, positioning is guesswork.

Three modes: **landscape** (market overview and positioning map), **competitors** (discovery, profiling, and synthesis), **topic** (targeted deep dives). Only one mode runs per invocation.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`. Functional references (`capability-gates.md`, `kb-search.md`) are loaded by the steps that need them.

**Workflow:** `research`

## Hard rules

- **Check existing KB before searching.** Every mode reads current `{pm_dir}/` state first. Update stale knowledge in place — never create parallel or duplicate files for the same topic.
- **Three sources make a finding; one is an anecdote.** Follow threads until convergence or explicit contradiction — no artificial depth limit. Research older than 90 days is a starting point, not an answer: check the `updated:` date before citing.
- **Separate facts from inferences.** Save findings with full source URLs and access dates; label inferences `Hypothesis:`. When a source contradicts existing knowledge, note the conflict explicitly — don't silently overwrite.
- **Use SEO tools when the provider is configured.** Web search shows what's loud; SEO shows what users actually search for.
- **Synthesis is not optional.** Raw profiles are data; synthesis is what makes them usable by strategy, ideate, and groom — enforced by the competitor-mode HARD-GATE.
- **Landscape before competitors.** Profiling without a market frame produces profiles disconnected from broader dynamics.
- **Absence of data is a finding.** If the user asked for it, write the file — even if it documents "no findable data." Never fabricate findings to fill a void.

## Setup detection

Research writes durable artifacts to `{pm_dir}/evidence/` — without a workspace, findings have nowhere to persist. If `{pm_dir}` does not exist:

> "No PM workspace found. Research writes into `{pm_dir}/evidence/` — run `/pm:start` first to set up the workspace, then re-invoke `/pm:research`."

Stop. For quick one-off questions that don't need saved artifacts, answer directly without this skill.

## When NOT to use

Factual questions that don't need a research file ("what's React Server Components?"), quick lookups, or questions the user can answer from memory. Research creates persistent artifacts — if the answer doesn't need to be saved, just answer directly.

## References

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` | Mode selection table and menu logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md` | 5-file competitor profiling methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/api-analysis.md` | API surface analysis methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/review-mining.md` | Review mining and sentiment analysis methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/seo-provider.md` | SEO provider routing and tool inventory |

## Resume

Research doesn't maintain session state — the KB artifacts themselves are the progress markers.

1. **Landscape mode:** if `{pm_dir}/insights/business/landscape.md` exists, mode routing handles it as an update flow. No separate resume.
2. **Competitor mode:** glob `{pm_dir}/evidence/competitors/*/profile.md`. If competitor directories exist with fewer than 5 files, some profiles are incomplete: "Found incomplete competitor profiles: {slugs with missing files}. Resume profiling from where it left off, or start fresh?" On resume, skip discovery and re-run profiling only for incomplete competitors, then synthesize.
3. **Topic mode:** if `{pm_dir}/evidence/research/{topic-slug}.md` exists with content, mode routing treats it as an update. No separate resume.

## Error handling

- **Web search returns nothing useful.** State what you searched and why results were empty; write a research file documenting the gap ("no findable data" is a real finding). Do not fabricate.
- **SEO provider fails mid-research.** Log the error, note it in the output file under Sources, and continue with web search only. Never block the flow on SEO availability.
- **Subagent fails during competitor profiling.** Check which files the agent produced; if partial (e.g., 3 of 5), re-run only the missing files inline — don't re-profile from scratch. If nothing was produced, fall back to sequential inline profiling.
- **Insight routing fails (topic mode).** The research file is still saved; routing is additive and can be re-run. Don't lose output because routing failed.
- **Hot index script missing or errors.** Fall back to direct file scan. Log the error but don't block topic research.
