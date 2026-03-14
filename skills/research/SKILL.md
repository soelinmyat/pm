---
name: pm-research
description: "Use when doing industry landscape analysis, competitive intelligence, competitor profiling, market research, keyword analysis, or building the product knowledge base. Three modes: landscape (industry overview, pre-strategy), competitors (deep profiling, post-strategy), topic (targeted investigation). Triggers on 'research,' 'landscape,' 'competitor,' 'competitive analysis,' 'market research,' 'keyword research,' 'industry overview.'"
---

# pm:research

## Purpose

Build and maintain the product knowledge base. Research gates strategy and grooming — without it, positioning is guesswork.

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `pm/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `pm/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `pm/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Mode Routing

| Argument | Mode |
|---|---|
| `landscape` | Landscape Mode |
| `competitors` | Competitor Mode |
| _(no arg, no `pm/landscape.md`)_ | Landscape Mode (first-time default) |
| _(no arg, `pm/landscape.md` exists)_ | Present menu |
| anything else | Topic Mode (argument is the topic name) |

When no argument is given and `pm/landscape.md` exists, present:

> "What would you like to research?
> (a) Update landscape overview
> (b) Profile competitors
> (c) Research a specific topic"

Wait for user selection before proceeding.

---

## Landscape Mode (`$pm-research landscape`)

### When to Use

First research activity in a new project. Produces the market overview that makes strategy interviews more specific and competitor profiling more targeted.

### Flow

1. **SEO market intelligence** (if provider configured).
   Read `.pm/config.json` for the `seo.provider` value.
   - If `"ahrefs-mcp"`: use the Ahrefs MCP tools:
     - `keywords-explorer-matching-terms` — get keyword ideas for the product category (limit 30). Shows search demand behind the space.
     - `keywords-explorer-volume-by-country` — for the top 3-5 keywords, check volume distribution across target countries (especially SEA markets if relevant). Reveals geographic demand.
     - `keywords-explorer-overview` — get volume, difficulty, CPC for core category keywords. Shows market maturity.
     - `site-explorer-organic-competitors` — if any known competitor domains exist, discover who else competes in the same keyword space. Reveals players not found via web search.
   - If `"none"` or returns an error: skip, log the error, continue with web search.

2. **Web search for market overview.** Search for:
   - "{space} market overview" / "{space} industry landscape {year}"
   - Key vendors and their positioning
   - Market segments and buyer types
   - Analyst or press coverage

3. **Present findings for validation.** Show a structured summary before writing. Ask:
   > "Does this look like the right landscape? Anything to add or correct before I write the file?"

4. **Write `pm/landscape.md`** (see structure below). Include the **Market Positioning Map** section with structured HTML comment data. Choose two axes that reveal strategic whitespace (e.g., vertical-specific vs horizontal, SMB vs Enterprise). Plot every key player as a comment row. The dashboard parses these comments and renders an interactive bubble chart — bubble size reflects organic traffic, color reflects segment.

5. **Visual companion.** If `visual_companion: true` in `.pm/config.json`: invoke `$pm-view` so the user can review the landscape and positioning map visually.

### Landscape Document Structure

```markdown
---
type: landscape
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources:
  - url: ...
    accessed: YYYY-MM-DD
---

# Market Landscape: {Space}

<!-- stat: {value}, {label} -->
<!-- stat: {value}, {label} -->
<!-- stat: {value}, {label} -->
<!-- stat: {value}, {label} -->

Add 3-5 headline stat comments right after the h1 title. Pick the most impactful numbers from the research (adoption rates, market size, search volume, growth metrics). The dashboard renders these as a stat card row at the top of the page.

## Market Overview
2-3 paragraph summary: market size, growth direction, primary buyer, key dynamics.

## Key Players

| Company | Positioning | Primary Segment | Notable |
|---|---|---|---|
| [Company](https://domain.com) | ... | ... | ... |

Use markdown links for company names so the dashboard renders them as clickable links to their websites.

## Keyword Landscape
Top terms by volume (if SEO configured) or qualitative keyword clusters (web search only).

| Keyword | Volume | Difficulty | Notes |
|---|---|---|---|

## Market Segments
Named segments with a 1-sentence description each. Who buys, why, and at what price sensitivity.

## Market Positioning Map

<!-- positioning: company, x (0-100, x-axis-low-label to x-axis-high-label), y (0-100, y-axis-low-label to y-axis-high-label), traffic, segment-color -->
<!-- Company A, 85, 30, 311655, horizontal -->
<!-- Company B, 20, 60, 3091, mid-market -->
<!-- Our Product, 25, 50, 0, self -->

Choose two axes that reveal strategic whitespace (e.g., vertical-specific vs horizontal, SMB vs Enterprise).
Each row is an HTML comment with: company name, x position (0-100), y position (0-100), monthly organic traffic, segment label.
The dashboard renders these as a bubble chart (bubble size = traffic, color = segment).

X-axis: {description of left to right}.
Y-axis: {description of bottom to top}.
Dot size: Monthly organic traffic. Color: segment.

{1-2 sentences explaining where your product sits and what the whitespace reveals.}

## Initial Observations
3-5 bullets. Gaps, tensions, underserved segments, or early hypotheses worth testing.
```

### Update Flow

When `pm/landscape.md` exists and user runs landscape mode again: re-run searches, diff against existing content, present changes for review, update the file in place, bump `updated:` in frontmatter.

---

## Competitor Mode (`$pm-research competitors`)

### Phase 1: Discover

The goal is to find **genuinely close competitors** — not just well-known players in the broad category. Landscape key players are a starting point, not the final list.

1. **Start with landscape.** If `pm/landscape.md` exists, pull the Key Players table as a seed list.
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
5. Write or update `pm/competitors/index.md` with confirmed candidates (name, slug, one-line description, competitor tier).

### Phase 2: Profile

Determine dispatch strategy based on candidate count and environment:

**1 competitor:** Profile inline. Create all 5 files per competitor:
1. Read methodology in `skills/research/competitor-profiling.md`
2. Create `pm/competitors/{slug}/profile.md`
3. Create `pm/competitors/{slug}/features.md`
4. Create `pm/competitors/{slug}/api.md`
5. Create `pm/competitors/{slug}/seo.md` (note if SEO data unavailable per provider config)
6. Create `pm/competitors/{slug}/sentiment.md`

Verify all 5 files exist before proceeding to Phase 3.

**2+ competitors, subagents available (Claude Code, Codex):**
Dispatch one researcher agent per competitor in parallel. Use this syntax for each:

```
Agent tool: name="researcher-{slug}", prompt="Profile {Company Name} in the {space} space.
Slug: {slug}. Follow the methodology in skills/research/competitor-profiling.md exactly.
Write all output files to pm/competitors/{slug}/.
Do NOT write to pm/competitors/index.md — that is owned by the parent skill."
```

Wait for all agents to complete, then validate output for each competitor:

```
For each {slug}, verify these 5 files exist:
- pm/competitors/{slug}/profile.md
- pm/competitors/{slug}/features.md
- pm/competitors/{slug}/api.md
- pm/competitors/{slug}/seo.md
- pm/competitors/{slug}/sentiment.md

If any file is missing, re-run that section of research before proceeding to Phase 3.
```

**2+ competitors, no subagents (Gemini, OpenCode, Cursor):**
Profile sequentially inline, one at a time. After each: "Finished {name}. Profile {next name} now?" Wait for confirmation before continuing.

**Subagent detection:** Attempt the Agent tool dispatch. If the environment returns an error or the tool is unavailable, fall back to sequential inline profiling automatically.

**Index ownership:** Researcher agents write only to `pm/competitors/{slug}/`. The parent skill owns `pm/competitors/index.md`. Never delegate index writes to subagents.

### Phase 3: Synthesize

**Pre-synthesis validation.** Before proceeding, verify all profiles have all 5 files:

For each competitor slug, check:
- [ ] `pm/competitors/{slug}/profile.md` exists
- [ ] `pm/competitors/{slug}/features.md` exists
- [ ] `pm/competitors/{slug}/api.md` exists
- [ ] `pm/competitors/{slug}/seo.md` exists
- [ ] `pm/competitors/{slug}/sentiment.md` exists

If any file is missing, stop and ask: "Profile {slug} is incomplete. Missing: {files}. Re-run profiling for these files?"

Only proceed to synthesis after all files are present.

1. Update `pm/competitors/index.md` — add links to each profile, last-profiled date.
2. Write or update `pm/competitors/matrix.md` — feature comparison table across all profiled competitors.
3. Add a **Market Gaps** section to `pm/competitors/index.md` — capabilities absent or weak across all competitors.
4. **Update `pm/landscape.md`** — keep the landscape as the single source of truth for the market view:
   - **Key Players table:** Add any newly profiled competitors that aren't already listed (with website links). Remove any that turned out to be irrelevant. Update positioning/notable columns with insights from profiling.
   - **Market Positioning Map:** Add `<!-- positioning -->` comment rows for newly profiled competitors. Adjust x/y coordinates based on what profiling revealed about their actual positioning. Remove entries for competitors that were dropped.
   - **Initial Observations:** Update if competitor profiling revealed new gaps, tensions, or insights that change the market read.
   - Bump the `updated:` date in frontmatter.
5. **Launch dashboard.** If `visual_companion: true` in `.pm/config.json`: invoke `$pm-view` so the user can review the updated landscape, positioning map, and competitor profiles visually.

### Cost Guardrail

Before running batch SEO calls across multiple competitors, estimate the request count and show:

> "This will make approximately {N} SEO API calls across {M} competitors. Estimated cost: ~${X}. Proceed?"

Only continue after explicit confirmation.

---

## Topic Mode (`$pm-research {topic}`)

For targeted deep dives not covered by landscape or competitor profiling.

### Flow

1. **Check existing knowledge.** Read `pm/research/index.md` if it exists. Check `pm/landscape.md` and `pm/strategy.md` for relevant context.
   Treat `source_origin: internal` and `source_origin: mixed` topics as customer evidence from `$pm-ingest`, not just external research.
2. **Check strategy alignment.** If `pm/strategy.md` exists, note how the topic relates to current priorities.
3. **Search demand check** (if ahrefs-mcp configured).
   - `keywords-explorer-overview` — get volume, difficulty, CPC for the topic as a keyword. Quantifies how much people search for this.
   - `serp-overview` — see who currently ranks for the topic keyword and what the SERP looks like. Reveals content competition and opportunity.
   - If volume is significant, note it in findings. If zero volume, the topic may be too niche for SEO-driven content — note that too.
4. **Web search.** Search for the topic directly. Fill gaps with follow-up searches.
5. **Write findings** to `pm/research/{topic-slug}/findings.md` using the shared topic schema:

```markdown
---
type: topic-research
topic: {Topic Name}
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_origin: external|mixed
sources:
  - url: ...
    accessed: YYYY-MM-DD
# Keep internal evidence fields if they already exist on a mixed topic file.
evidence_count: 17
segments:
  - SMB
confidence: high
---

# {Topic Name}

## Summary
2-3 sentences. The key answer to "what did we learn?"

## Findings
Numbered findings with supporting evidence and source references.
Prefix external findings with `[external]` when the topic is mixed.

## Representative Quotes
Present only if the topic already contains internal evidence. Do not delete it.

## Strategic Relevance
How this supports or challenges the current strategy.
If inferred, label it clearly.

## Implications
What this means for the product. Link to strategy sections if relevant.

## Open Questions
What this research did NOT answer.

## Source References
- https://example.com/article — accessed YYYY-MM-DD
```

   Mixed-origin write rules:
   - If the topic file already exists with `source_origin: internal`, switch it to `mixed`
   - Append external `sources` entries and `[external]` findings without deleting internal evidence
   - Rewrite shared sections (`Summary`, `Strategic Relevance`, `Implications`) so they reflect both internal and external evidence

6. **Update `pm/research/index.md`** — add or update the row for this topic with:
   - `Origin`: `external` or `mixed`
   - `Evidence`: source count for pure external topics, or combined evidence summary for mixed topics
   - one-line summary

---

## SEO Provider Invocation

Read `.pm/config.json` to determine the configured SEO provider. Route calls based on the provider:

### Provider: `"ahrefs-mcp"` (recommended)

Use the Ahrefs MCP tools directly. These are available as MCP tool calls when the Ahrefs MCP server is connected. The tool names are prefixed with `mcp__ahrefs__` (the exact prefix depends on how the server was registered — check available tools).

Always call `mcp__ahrefs__doc` with the specific tool name before first use to get the correct input schema.

#### Tool inventory by use case

**Keyword research:**
- `keywords-explorer-overview` — volume, difficulty, CPC for specific keywords
- `keywords-explorer-matching-terms` — keyword ideas matching a seed term
- `keywords-explorer-related-terms` — "also rank for" and "also talk about" keywords
- `keywords-explorer-search-suggestions` — autocomplete-style suggestions
- `keywords-explorer-volume-by-country` — volume distribution by country (critical for regional products)
- `keywords-explorer-volume-history` — search trend over time

**Domain analysis:**
- `site-explorer-metrics` — organic traffic, keywords, traffic value
- `site-explorer-metrics-by-country` — traffic breakdown by country
- `site-explorer-domain-rating` — domain authority score
- `site-explorer-organic-keywords` — keywords a domain ranks for (with position, volume, traffic)
- `site-explorer-organic-competitors` — domains competing for the same keywords
- `site-explorer-top-pages` — highest-traffic pages on a domain
- `site-explorer-pages-by-traffic` — page distribution by traffic bucket

**Backlink analysis:**
- `site-explorer-backlinks-stats` — backlink and referring domain counts
- `site-explorer-referring-domains` — detailed referring domain list

**SERP analysis:**
- `serp-overview` — who ranks for a keyword, with DR, backlinks, traffic per result

**Efficiency:**
- `batch-analysis` — analyze up to 100 URLs/domains in one call (use for competitor comparison)

#### When to use which

| PM skill | Primary tools | Purpose |
|---|---|---|
| Landscape | keywords-explorer-matching-terms, volume-by-country, organic-competitors | Market demand, geographic distribution, player discovery |
| Competitor seo.md | batch-analysis or site-explorer-metrics + organic-keywords + top-pages + metrics-by-country | Domain strength, content strategy, geographic reach |
| Topic research | keywords-explorer-overview, serp-overview | Search demand validation, content competition |
| Dig (quick check) | keywords-explorer-overview | Fast demand signal |

If an Ahrefs MCP tool call fails or returns an error, display the error to the user, note it in the output file under Sources, and continue research with web search.

### Provider: `"none"`

Skip all SEO calls. Proceed with web search only. Do not error.

---

## Research Rules

1. Always check existing `pm/` knowledge before running new searches. Do not duplicate what is already documented.
2. Save findings with full source URLs and access dates.
3. Update existing files in place. Never create duplicate research files for the same topic.
4. No artificial limit on search depth — follow threads until the question is genuinely answered or the sources become circular.
5. Distinguish facts (sourced) from inferences (labeled "Hypothesis:") in all output files.
6. When a source contradicts existing knowledge, note the conflict explicitly. Do not silently overwrite.
