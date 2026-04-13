---
name: Landscape Mode
order: 3
description: Industry landscape research — market overview, key players, keyword landscape, and positioning map
---

## Landscape Mode (`$pm-research landscape`)

**Goal:** Produce (or update) the market landscape document — market overview, key players, keyword landscape, and positioning map — so that strategy and competitor profiling have a grounded market frame.

### When to Use

First research activity in a new project. Produces the market overview that makes strategy interviews more specific and competitor profiling more targeted.

### How

1. **Determine the market space.**
   - If `{pm_dir}/strategy.md` exists, read it and extract the market/product space from the positioning or product description.
   - Otherwise, ask the user: *"What market or product space should I research?"*
   - Use the answer as `{space}` in all search templates below.

2. **SEO market intelligence** (if provider configured).
   Read `{pm_state_dir}/config.json` for the `seo.provider` value. See `${CLAUDE_PLUGIN_ROOT}/skills/research/references/seo-provider.md` for tool details.
   - If `"ahrefs-mcp"`: use Ahrefs MCP tools to:
     - Get keyword ideas for the product category (matching terms, limit 30). Shows search demand behind the space.
     - For the top 3-5 keywords, check volume distribution across target countries (especially SEA markets if relevant). Reveals geographic demand.
     - Get volume, difficulty, CPC for core category keywords. Shows market maturity.
     - If any known competitor domains exist, discover organic competitors in the same keyword space. Reveals players not found via web search.
   - If `"none"` or returns an error: skip, log the error, continue with web search.

3. **Web search for market overview.** Search for:
   - "{space} market overview" / "{space} industry landscape {year}"
   - Key vendors and their positioning
   - Market segments and buyer types
   - Analyst or press coverage

4. **Present findings for validation.** Show a structured summary before writing. Ask:
   > "Does this look like the right landscape? Anything to add or correct before I write the file?"

5. **Write `{pm_dir}/insights/business/landscape.md`** (see structure below). Include the **Market Positioning Map** section with structured HTML comment data. Choose two axes that reveal strategic whitespace (e.g., vertical-specific vs horizontal, SMB vs Enterprise). Plot every key player as a comment row.
   After writing, append the touched file to `{pm_dir}/insights/business/log.md`. Update `{pm_dir}/insights/business/index.md` too if it needs to reflect the new state of the domain.

### Landscape Document Structure

```markdown
---
type: insight
domain: business
topic: "Market Landscape: {Space}"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: active
confidence: medium
sources:
  - url: ...
    accessed: YYYY-MM-DD
---

# Market Landscape: {Space}

<!-- stat: {value}, {label} -->
<!-- stat: {value}, {label} -->
<!-- stat: {value}, {label} -->
<!-- stat: {value}, {label} -->

Add 3-5 headline stat comments right after the h1 title. Pick the most impactful numbers from the research (adoption rates, market size, search volume, growth metrics).

## Market Overview
2-3 paragraph summary: market size, growth direction, primary buyer, key dynamics.

## Key Players

| Company | Positioning | Primary Segment | Notable |
|---|---|---|---|
| [Company](https://domain.com) | ... | ... | ... |

Use markdown links for company names so they render as clickable links.

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
These structured comments encode a positioning bubble chart (bubble size = traffic, color = segment).

X-axis: {description of left to right}.
Y-axis: {description of bottom to top}.
Dot size: Monthly organic traffic. Color: segment.

{1-2 sentences explaining where your product sits and what the whitespace reveals.}

## Initial Observations
3-5 bullets. Gaps, tensions, underserved segments, or early hypotheses worth testing.
```

### Update Flow

When `{pm_dir}/insights/business/landscape.md` exists and user runs landscape mode again: re-run searches, diff against existing content, present changes for review, update the file in place, bump `last_updated:` in frontmatter.

**Done-when:** `{pm_dir}/insights/business/landscape.md` exists with all template sections populated, user has validated findings, and indexes/logs are updated. For updates: `updated:` date is bumped and the user confirmed the diff.
