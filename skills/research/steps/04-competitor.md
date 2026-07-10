---
name: Competitor Mode
order: 4
description: Competitor discovery, profiling (5 files per competitor), and synthesis with HARD-GATE on synthesis
---

## Competitor Mode (`$pm-research competitors`)

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

**Goal:** Discover close competitors, produce 5-file profiles for each, and synthesize findings into the competitor index and landscape document so downstream skills (strategy, ideate, groom) can use them.

**Loop worker branch:** If `PM_LOOP_WORKER=1`, read existing PM context but consolidate the five-file profiling output and synthesis into `PM_LOOP_RESULT_DIR/artifacts/competitor-{slug}.md`. Preserve source convergence, profile completeness, synthesis, and verification. Skip all normal PM profile, index, insight-routing, and log writes; atomically return the document through `PM_LOOP_RESULT_FILE` as `artifact-ready` (or `blocked`, `failed`, `noop`).

### Phase 1: Discover

The goal is to find **genuinely close competitors** — not just well-known players in the broad category. Landscape key players are a starting point, not the final list.

1. **Start with landscape.** If `{pm_dir}/insights/business/landscape.md` exists, pull the Key Players table as a seed list.
2. **Go deeper.** Do NOT stop at the landscape list. Run additional searches to find competitors the landscape may have missed:
   - Search for tools on the **same platform** (e.g., other Claude Code plugins, Cursor plugins, IDE extensions that do similar work).
   - Search for tools targeting the **same user** (e.g., "AI tools for [ICP role]", "[workflow] tool for [audience]").
   - Search for tools solving the **same problem** differently (e.g., web apps, CLI tools, browser extensions).
   - Search GitHub, plugin marketplaces, Product Hunt, and Indie Hackers for emerging/unlisted competitors.
   - If `"ahrefs-mcp"` is configured: use Ahrefs MCP tools to discover organic competitors for any known competitor domain — reveals who else competes for the same keywords.
3. **Filter by relevance.** Classify candidates by proximity:
   - **Direct competitors**: Same platform, same workflow, same audience.
   - **Adjacent competitors**: Different platform or delivery model, but overlapping use case.
   - **Aspirational competitors**: Different segment entirely (e.g., enterprise SaaS), but set user expectations for what the product category should do.
   Present all three tiers. Recommend profiling direct and adjacent competitors. Aspirational competitors are optional context.
4. **Confirm with user.** Ask: "Which of these should I profile? (Select all, a subset, or add unlisted competitors.)"
5. Write or update `{pm_dir}/evidence/competitors/index.md` with confirmed candidates (name, slug, one-line description, competitor tier), then append touched files to `{pm_dir}/evidence/competitors/log.md`.

### Phase 2: Profile

**5-file completeness check (used throughout this phase and the synthesis gate):** every competitor slug must have all five files under `{pm_dir}/evidence/competitors/{slug}/` — `profile.md`, `features.md`, `api.md`, `seo.md` (note if SEO data is unavailable per provider config), `sentiment.md`. If any is missing, re-run only that section of research before proceeding.

Determine dispatch strategy based on candidate count and runtime capability. Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` and `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for the runtime-neutral dispatch mechanics — do not hardcode any one runtime's dispatch syntax.

**1 competitor:** Profile inline. Read the methodology in `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md`, create the five files, then run the completeness check before Phase 3.

**2+ competitors:** Profile each competitor with a fresh, single-competitor agent. The task for each agent:

> Profile {Company Name} ({slug}) in the {space} space. Follow the methodology in `${CLAUDE_PLUGIN_ROOT}/skills/research/references/competitor-profiling.md` exactly. Write all output files to `{pm_dir}/evidence/competitors/{slug}/` and nowhere else — do NOT touch `{pm_dir}/evidence/competitors/index.md` (the parent skill owns it).

Competitor profiling mutates files, but each agent writes only its own `{slug}/` directory — the outputs are **disjoint**, so parallel dispatch is safe wherever the runtime supports delegated execution. This is an explicit delegated-execution choice, not the read-only-review-wave default. Follow `agent-runtime.md`:

- **Claude, or Codex with delegation enabled:** dispatch all per-competitor agents together, then collect results.
- **Codex without delegation, or any runtime without subagents:** profile sequentially inline, one at a time. After each: "Finished {name}. Profile {next name} now?" Wait for confirmation before continuing.

Never emit dispatch syntax the current runtime can't execute — resolve the mechanism through `agent-runtime.md` and fall back to sequential inline automatically when subagents are unavailable. Once all competitors are profiled, run the 5-file completeness check for each before Phase 3.

**Index ownership:** Per-competitor agents write only to `{pm_dir}/evidence/competitors/{slug}/`. The parent skill owns `{pm_dir}/evidence/competitors/index.md`. Never delegate index writes to subagents.

### Phase 3: Synthesize

<HARD-GATE>
Synthesis is required after profiling. Do NOT skip because "the profiles are the deliverable."
Index updates, synthesized comparison content, market gaps, and landscape updates are what make individual profiles usable by downstream skills (strategy, ideate, groom).
Without synthesis, profiling is raw data — not knowledge.
</HARD-GATE>

**Pre-synthesis validation.** Re-run the 5-file completeness check across every competitor. If any file is missing, stop and ask: "Profile {slug} is incomplete. Missing: {files}. Re-run profiling for these files?" Only proceed to synthesis once all files are present.

1. Update `{pm_dir}/evidence/competitors/index.md` — add links to each profile, keep the directory summary current, and refresh any synthesized comparison content that lives there.
2. Add or update a **Market Gaps** section in `{pm_dir}/evidence/competitors/index.md` — capabilities absent or weak across all competitors.
3. **Update `{pm_dir}/insights/business/landscape.md`** — keep the landscape as the single source of truth for the market view:
   - **Key Players table:** Add any newly profiled competitors that aren't already listed (with website links). Remove any that turned out to be irrelevant. Update positioning/notable columns with insights from profiling.
   - **Market Positioning Map:** Add `<!-- positioning -->` comment rows for newly profiled competitors. Adjust x/y coordinates based on what profiling revealed about their actual positioning. Remove entries for competitors that were dropped.
   - **Initial Observations:** Update if competitor profiling revealed new gaps, tensions, or insights that change the market read.
   - Bump the `last_updated:` date in frontmatter.
4. Append touched paths to `{pm_dir}/evidence/competitors/log.md`. If synthesis changed the landscape, append that write to `{pm_dir}/insights/business/log.md` too.

### Phase 4: Route Findings to Insights

After synthesis, route key findings into insight topics so competitor intelligence compounds across the knowledge base.

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md`.

- **Evidence file path:** `{pm_dir}/evidence/competitors/index.md` (contains the synthesized Market Gaps and comparison data)
- **Key findings:** Extract from the Market Gaps section and any cross-competitor patterns that emerged during synthesis (e.g., feature gaps all competitors share, sentiment trends, positioning whitespace).

If no insight domains exist and no `{pm_dir}/strategy.md` exists, skip this step.

### Cost Guardrail

Before running batch SEO calls across multiple competitors, estimate the request count and show:

> "This will make approximately {N} SEO API calls across {M} competitors. Estimated cost: ~${X}. Proceed?"

Only continue after explicit confirmation.

Competitor mode is complete once all confirmed competitors pass the 5-file completeness check, the competitor index is updated with links and market gaps, the landscape document reflects new players and positioning-map entries, insight routing has run (or been explicitly skipped), and all logs are appended.
