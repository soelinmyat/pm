---
name: research
description: "Use when doing market research, competitive intelligence, or building the product knowledge base. Use when the user says 'research this', 'analyze the market', 'who are our competitors', 'what does the landscape look like', 'competitive analysis', 'research {topic}', 'what's the market for', 'profile competitors', 'update landscape', 'dig into {topic}', or wants durable research artifacts saved to the knowledge base. Three modes: landscape, competitors, topic. Outputs persistent research files — not quick answers."
---

# pm:research

## Purpose

Build and maintain the product knowledge base with durable, sourced research artifacts. Research gates strategy and grooming — without it, positioning is guesswork.

Three modes: **landscape** (market overview and positioning map), **competitors** (discovery, profiling, and synthesis), **topic** (targeted deep dives). Only one mode runs per invocation.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`. Functional references (`capability-gates.md`, `kb-search.md`) are loaded by the steps that need them.

**Workflow:** `research` | **Telemetry steps:** `note_digest`, `mode_routing`, `landscape`, `competitor`, `topic`

## Iron Law

**NEVER PRESENT INFERENCE AS FACT.**

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1` with `PM_LOOP_STAGE=research`, preserve sourcing, synthesis, and verification requirements. Do not write or update backlog/card state in loop mode—the loop worker is the only canonical durable card-state writer.

Atomically write the version-1 envelope to `PM_LOOP_RESULT_FILE`. Exact statuses: artifact-ready, blocked, failed, noop. `artifact-ready` includes one `document` payload (`kind: research`, run-relative path, SHA-256, media type); create that document with restrictive mode `0600`. `blocked` includes bounded code, reason, and remediation. The worker verifies and copies the document into the allowlisted PM destination before parking it for human review.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/research/steps/` in numeric filename order. If `.pm/workflows/research/` exists, same-named files there override defaults.

## Hard rules

- **Check existing KB before searching.** Every mode reads current `{pm_dir}/` state first. Update stale knowledge in place — never create parallel or duplicate files for the same topic.
- **Three sources make a finding; one is an anecdote.** Follow threads until convergence or explicit contradiction — no artificial depth limit. Check the `updated:` date before citing — staleness thresholds vary by data type (SEO ages fastest at 30 days, profiles/sentiment 60, landscape/topic 90); see `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/staleness-thresholds.md` for the canonical table.
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

## Red Flags — Self-Check

- **"One authoritative source is enough."** Keep searching until sources converge or the contradiction is explicit.
- **"This conclusion is obvious from the facts."** Include a hypothesis label and show the inference basis.
- **"The old file is easier to replace."** Use the canonical artifact and preserve user-authored context.
- **"No result means the search failed."** Capture the searched gap as a finding instead of fabricating coverage.
- **"The source was current when I last saw it."** Check its access date and the domain-specific staleness threshold.

## Escalation Paths

- **No durable artifact is needed:** Stop and answer the factual question directly.
- **Workspace is missing:** Route to `pm:start` before attempting research writeback.
- **Sources materially conflict:** Ask whether to deepen the disputed point or save the contradiction with bounded confidence.
- **The request is really a product decision:** Save the evidence first, then offer `pm:think`, `pm:strategy`, or `pm:groom` as the next lane.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "A polished narrative is more useful than caveats." | Decisions need provenance, confidence, and contradictions more than false certainty. |
| "A parallel file avoids disturbing existing work." | Duplicate topics fragment the knowledge base and make freshness unknowable. |

## Before Marking Done

- [ ] The canonical research artifact is saved with full source URLs, access dates, provenance, and explicit hypotheses.
- [ ] The user confirmed ambiguous mode/scope decisions and any high-cost provider use.
- [ ] Existing-KB, source convergence, staleness, synthesis, contradiction, writeback, and output verification gates passed.

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
