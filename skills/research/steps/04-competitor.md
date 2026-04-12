---
name: Competitor Mode
order: 4
description: Competitor discovery, profiling (5 files per competitor), and synthesis with HARD-GATE on synthesis
---

## Competitor Mode (`$pm-research competitors`)

### Phase 1: Discover

The goal is to find **genuinely close competitors** — not just well-known players in the broad category. Landscape key players are a starting point, not the final list.

1. **Start with landscape.** If `{pm_dir}/insights/business/landscape.md` exists, pull the Key Players table as a seed list.
2. **Go deeper.** Do NOT stop at the landscape list. Run additional searches to find competitors the landscape may have missed:
   - Search for tools on the **same platform** (e.g., other Claude Code plugins, Cursor plugins, IDE extensions that do similar work).
   - Search for tools targeting the **same user** (e.g., "AI tools for [ICP role]", "[workflow] tool for [audience]").
   - Search for tools solving the **same problem** differently (e.g., web apps, CLI tools, browser extensions).
   - Search GitHub, plugin marketplaces, Product Hunt, and Indie Hackers for emerging/unlisted competitors.
   - If `"ahrefs-mcp"` is configured: use `site-explorer-organic-competitors` on any known competitor domain to discover who else competes for the same keywords.
3. **Filter by relevance.** Classify candidates by proximity:
   - **Direct competitors**: Same platform, same workflow, same audience.
   - **Adjacent competitors**: Different platform or delivery model, but overlapping use case.
   - **Aspirational competitors**: Different segment entirely (e.g., enterprise SaaS), but set user expectations for what the product category should do.
   Present all three tiers. Recommend profiling direct and adjacent competitors. Aspirational competitors are optional context.
4. **Confirm with user.** Ask: "Which of these should I profile? (Select all, a subset, or add unlisted competitors.)"
5. Write or update `{pm_dir}/evidence/competitors/index.md` with confirmed candidates (name, slug, one-line description, competitor tier), then append touched files to `{pm_dir}/evidence/competitors/log.md`.

### Phase 2: Profile

Determine dispatch strategy based on candidate count and environment:

**1 competitor:** Profile inline. Create all 5 files per competitor:
1. Read methodology in `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md`
2. Create `{pm_dir}/evidence/competitors/{slug}/profile.md`
3. Create `{pm_dir}/evidence/competitors/{slug}/features.md`
4. Create `{pm_dir}/evidence/competitors/{slug}/api.md`
5. Create `{pm_dir}/evidence/competitors/{slug}/seo.md` (note if SEO data unavailable per provider config)
6. Create `{pm_dir}/evidence/competitors/{slug}/sentiment.md`

Verify all 5 files exist before proceeding to Phase 3.

**2+ competitors, subagents available (Claude Code, Codex):**
Dispatch one researcher agent per competitor in parallel. Use this syntax for each:

```
Agent tool: name="researcher-{slug}", prompt="Profile {Company Name} in the {space} space.
Slug: {slug}. Follow the methodology in ${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md exactly.
Write all output files to {pm_dir}/evidence/competitors/{slug}/.
Do NOT write to {pm_dir}/evidence/competitors/index.md — that is owned by the parent skill."
```

Wait for all agents to complete, then validate output for each competitor:

```
For each {slug}, verify these 5 files exist:
- {pm_dir}/evidence/competitors/{slug}/profile.md
- {pm_dir}/evidence/competitors/{slug}/features.md
- {pm_dir}/evidence/competitors/{slug}/api.md
- {pm_dir}/evidence/competitors/{slug}/seo.md
- {pm_dir}/evidence/competitors/{slug}/sentiment.md

If any file is missing, re-run that section of research before proceeding to Phase 3.
```

**2+ competitors, no subagents (Gemini, OpenCode, Cursor):**
Profile sequentially inline, one at a time. After each: "Finished {name}. Profile {next name} now?" Wait for confirmation before continuing.

**Subagent detection:** Attempt the Agent tool dispatch. If the environment returns an error or the tool is unavailable, fall back to sequential inline profiling automatically.

**Index ownership:** Researcher agents write only to `{pm_dir}/evidence/competitors/{slug}/`. The parent skill owns `{pm_dir}/evidence/competitors/index.md`. Never delegate index writes to subagents.

### Phase 3: Synthesize

<HARD-GATE>
Synthesis is required after profiling. Do NOT skip because "the profiles are the deliverable."
Index updates, synthesized comparison content, market gaps, and landscape updates are what make individual profiles usable by downstream skills (strategy, ideate, groom).
Without synthesis, profiling is raw data — not knowledge.
</HARD-GATE>

**Pre-synthesis validation.** Before proceeding, verify all profiles have all 5 files:

For each competitor slug, check:
- [ ] `{pm_dir}/evidence/competitors/{slug}/profile.md` exists
- [ ] `{pm_dir}/evidence/competitors/{slug}/features.md` exists
- [ ] `{pm_dir}/evidence/competitors/{slug}/api.md` exists
- [ ] `{pm_dir}/evidence/competitors/{slug}/seo.md` exists
- [ ] `{pm_dir}/evidence/competitors/{slug}/sentiment.md` exists

If any file is missing, stop and ask: "Profile {slug} is incomplete. Missing: {files}. Re-run profiling for these files?"

Only proceed to synthesis after all files are present.

1. Update `{pm_dir}/evidence/competitors/index.md` — add links to each profile, keep the directory summary current, and refresh any synthesized comparison content that lives there.
2. Add or update a **Market Gaps** section in `{pm_dir}/evidence/competitors/index.md` — capabilities absent or weak across all competitors.
3. **Update `{pm_dir}/insights/business/landscape.md`** — keep the landscape as the single source of truth for the market view:
   - **Key Players table:** Add any newly profiled competitors that aren't already listed (with website links). Remove any that turned out to be irrelevant. Update positioning/notable columns with insights from profiling.
   - **Market Positioning Map:** Add `<!-- positioning -->` comment rows for newly profiled competitors. Adjust x/y coordinates based on what profiling revealed about their actual positioning. Remove entries for competitors that were dropped.
   - **Initial Observations:** Update if competitor profiling revealed new gaps, tensions, or insights that change the market read.
   - Bump the `updated:` date in frontmatter.
4. Append touched paths to `{pm_dir}/evidence/competitors/log.md`. If synthesis changed the landscape, append that write to `{pm_dir}/insights/business/log.md` too.

### Cost Guardrail

Before running batch SEO calls across multiple competitors, estimate the request count and show:

> "This will make approximately {N} SEO API calls across {M} competitors. Estimated cost: ~${X}. Proceed?"

Only continue after explicit confirmation.
