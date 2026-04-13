---
name: research
description: "Use when doing market research, competitive intelligence, or building the product knowledge base. Use when the user says 'research this', 'analyze the market', 'who are our competitors', 'what does the landscape look like', 'competitive analysis', 'research {topic}', 'what's the market for', 'profile competitors', 'update landscape', 'dig into {topic}', or wants durable research artifacts saved to the knowledge base. Three modes: landscape, competitors, topic. Outputs persistent research files — not quick answers."
---

# pm:research

## Purpose

Build and maintain the product knowledge base with durable, sourced research artifacts. Research gates strategy and grooming — without it, positioning is guesswork.

Three modes: **landscape** (market overview and positioning map), **competitors** (discovery, profiling, and synthesis), **topic** (targeted deep dives). Only one mode runs per invocation.

## Iron Law

**NEVER WRITE FINDINGS WITHOUT CHECKING EXISTING KNOWLEDGE FIRST.** Every research mode must read the current KB state before running searches. Duplicating what is already documented wastes time and creates conflicting sources of truth. If existing knowledge is stale, update in place — do not create parallel files.

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

Read `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` for the KB search protocol — use it for dedup checks before writing any research artifact.

**Workflow:** `research` | **Telemetry steps:** `note-digest`, `mode-routing`, `landscape`, `competitor`, `topic`

**When NOT to use:** Factual questions that don't need a research file ("what's React Server Components?"), quick lookups, or questions the user can answer from memory. Research creates persistent artifacts — if the answer doesn't need to be saved, just answer directly.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/research/steps/` in numeric filename order. If `.pm/workflows/research/` exists, same-named files there override defaults. Execute each step in order. Only one research mode (landscape, competitor, or topic) runs per invocation — see Step 2 (Mode Routing).

## References

The following reference files provide detailed guidance for specific research phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` | Mode selection table and menu logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md` | 5-file competitor profiling methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/api-analysis.md` | API surface analysis methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/review-mining.md` | Review mining and sentiment analysis methodology |
| `${CLAUDE_PLUGIN_ROOT}/skills/research/references/seo-provider.md` | SEO provider routing and tool inventory |

---

## Resume

Before doing anything else, check for in-progress research state:

1. **Landscape mode:** If `{pm_dir}/insights/business/landscape.md` exists, mode routing handles this as an update flow. No separate resume needed.
2. **Competitor mode:** Glob `{pm_dir}/evidence/competitors/*/profile.md`. If competitor directories exist but have fewer than 5 files, some profiles are incomplete. Say:
   > "Found incomplete competitor profiles: {list slugs with missing files}. Resume profiling from where it left off, or start fresh?"
   Wait for the user's answer. If resuming, skip discovery (Phase 1) and re-run profiling only for incomplete competitors, then proceed to synthesis.
3. **Topic mode:** If `{pm_dir}/evidence/research/{topic-slug}.md` exists with content, mode routing treats this as an update. No separate resume needed.

Resume is lightweight — research doesn't maintain session state files. The KB artifacts themselves are the progress markers.

---

## Research Rules

1. Always check existing `{pm_dir}/` knowledge before running new searches. Do not duplicate what is already documented.
2. Save findings with full source URLs and access dates.
3. Update existing files in place. Never create duplicate research files for the same topic.
4. No artificial limit on search depth — follow threads until the question is genuinely answered or the sources become circular.
5. Distinguish facts (sourced) from inferences (labeled "Hypothesis:") in all output files.
6. When a source contradicts existing knowledge, note the conflict explicitly. Do not silently overwrite.

---

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"One good source confirms it, I can stop searching."** One source is an anecdote. Three sources are a finding. Keep going until you have convergence or explicit contradiction.
- **"Web search is enough, skip SEO tools."** Web search shows what's loud. SEO shows what users actually search for. If the provider is configured, use it.
- **"Existing research covers this, no need to check dates."** Research older than 90 days is a starting point, not an answer. Always check the `updated:` date before citing.
- **"The profiles are the deliverable, synthesis is optional."** Raw profiles are data, not knowledge. Synthesis is what makes individual profiles usable by strategy, ideate, and groom. The HARD-GATE exists for a reason.
- **"This topic is too niche for a research file."** If the user asked for it, it's worth documenting. The absence of data is itself a finding — write a file that says so.
- **"I'll skip the landscape and go straight to competitors."** Landscape establishes the market frame. Competitor profiling without landscape context produces profiles disconnected from the broader market dynamics.

## Escalation Paths

- **User wants opinions, not research:** "This sounds more like a thinking exercise than a research project. Want to run `/pm:think` instead?"
- **Research reveals strategic implications:** "This finding changes how we should think about positioning. Want to update strategy with `/pm:strategy` after we finish?"
- **Research reveals a buildable opportunity:** "Research shows a clear gap. Want to groom it into a proposal with `/pm:groom`?"
- **Topic needs customer evidence, not external research:** "This question is better answered by your own users. Consider running `/pm:ingest` on customer feedback data."
- **Research scope keeps expanding:** "We've branched into {N} sub-topics. Let me save what we have for '{topic}' and research the next one separately."

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Web search is enough, skip SEO tools" | Web search shows what's loud. SEO shows what users actually search for. |
| "One source confirms it" | One source is an anecdote. Three sources are a finding. |
| "Market data isn't needed for this feature" | You don't know if market data is needed until you look. The absence of data is a finding. |
| "Existing research covers this" | Check the date. Research older than 90 days is a starting point, not an answer. |

---

## Error Handling

**Web search returns nothing useful.** State what you searched for and why results were empty. Write a research file documenting the gap — "no findable data" is a real finding that downstream skills need to know. Do not fabricate findings to fill the void.

**SEO provider fails mid-research.** Log the error, note it in the output file under Sources, and continue with web search only. Never block the entire research flow on SEO availability.

**Subagent fails during competitor profiling.** Check which files the agent produced before failing. If partial (e.g., 3 of 5 files), re-run only the missing files inline. Do not re-profile from scratch. If the agent produced nothing, fall back to sequential inline profiling for that competitor.

**Insight routing fails (topic mode).** If `insight-routing.md` errors or the user skips routing, the research file is still saved. Routing is additive — it can be re-run later. Do not lose the research output because routing failed.

**Hot index script missing or errors.** Fall back to direct file scan. Log the error but do not block topic research.

---

## Before Marking Done

- [ ] Every source has a URL and access date
- [ ] Facts are sourced; inferences are labeled "Hypothesis:"
- [ ] Checked existing `{pm_dir}/` knowledge first — no duplicate files created
- [ ] Contradictions with existing knowledge noted explicitly
- [ ] Research file saved to the correct location under `{pm_dir}/evidence/` or `{pm_dir}/insights/`
- [ ] For competitor mode: synthesis completed (index updated, landscape updated, market gaps documented)
