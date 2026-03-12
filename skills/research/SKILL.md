---
name: research
description: "Use when doing industry landscape analysis, competitive intelligence, competitor profiling, market research, keyword analysis, or building the product knowledge base. Three modes: landscape (industry overview, pre-strategy), competitors (deep profiling, post-strategy), topic (targeted investigation). Triggers on 'research,' 'landscape,' 'competitor,' 'competitive analysis,' 'market research,' 'keyword research,' 'industry overview.'"
---

# pm:research

## Purpose

Build and maintain the product knowledge base. Research gates strategy and grooming — without it, positioning is guesswork.

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

## Landscape Mode (`/pm:research landscape`)

### When to Use

First research activity in a new project. Produces the market overview that makes strategy interviews more specific and competitor profiling more targeted.

### Flow

1. **SEO keyword check** (if provider configured).
   Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/seo-provider.js getKeywords "{product category}" --limit 20`
   If provider is `"none"` or returns `{"error": "..."}`: skip, log the error, continue with web search.

2. **Web search for market overview.** Search for:
   - "{space} market overview" / "{space} industry landscape {year}"
   - Key vendors and their positioning
   - Market segments and buyer types
   - Analyst or press coverage

3. **Present findings for validation.** Show a structured summary before writing. Ask:
   > "Does this look like the right landscape? Anything to add or correct before I write the file?"

4. **Write `pm/landscape.md`** (see structure below).

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

## Market Overview
2-3 paragraph summary: market size, growth direction, primary buyer, key dynamics.

## Key Players

| Company | Positioning | Primary Segment | Notable |
|---|---|---|---|
| ...     | ...         | ...             | ...     |

## Keyword Landscape
Top terms by volume (if SEO configured) or qualitative keyword clusters (web search only).

| Keyword | Volume | Difficulty | Notes |
|---|---|---|---|

## Market Segments
Named segments with a 1-sentence description each. Who buys, why, and at what price sensitivity.

## Initial Observations
3-5 bullets. Gaps, tensions, underserved segments, or early hypotheses worth testing.
```

### Update Flow

When `pm/landscape.md` exists and user runs landscape mode again: re-run searches, diff against existing content, present changes for review, update the file in place, bump `updated:` in frontmatter.

---

## Competitor Mode (`/pm:research competitors`)

### Phase 1: Discover

1. If `pm/landscape.md` exists: pull the Key Players table as the candidate list.
2. If not: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/seo-provider.js getCompetitors "{product}"` and supplement with web search.
3. Present the candidate list. Ask: "Which of these should I profile? (Select all, a subset, or add unlisted competitors.)"
4. Write or update `pm/competitors/index.md` with confirmed candidates (name, slug, one-line description).

### Phase 2: Profile

Determine dispatch strategy based on candidate count and environment:

**1 competitor:** Profile inline. Follow methodology in `skills/research/competitor-profiling.md`.

**2+ competitors, subagents available (Claude Code, Codex):**
Dispatch one researcher agent per competitor in parallel. Use this syntax for each:

```
Agent tool: name="researcher-{slug}", prompt="Profile {Company Name} in the {space} space.
Slug: {slug}. Follow the methodology in skills/research/competitor-profiling.md exactly.
Write all output files to pm/competitors/{slug}/.
Do NOT write to pm/competitors/index.md — that is owned by the parent skill."
```

Wait for all agents to complete before Phase 3.

**2+ competitors, no subagents (Gemini, OpenCode, Cursor):**
Profile sequentially inline, one at a time. After each: "Finished {name}. Profile {next name} now?" Wait for confirmation before continuing.

**Subagent detection:** Attempt the Agent tool dispatch. If the environment returns an error or the tool is unavailable, fall back to sequential inline profiling automatically.

**Index ownership:** Researcher agents write only to `pm/competitors/{slug}/`. The parent skill owns `pm/competitors/index.md`. Never delegate index writes to subagents.

### Phase 3: Synthesize

After all profiles are complete:

1. Update `pm/competitors/index.md` — add links to each profile, last-profiled date.
2. Write or update `pm/competitors/matrix.md` — feature comparison table across all profiled competitors.
3. Add a **Market Gaps** section to `pm/competitors/index.md` — capabilities absent or weak across all competitors.
4. If `visual_companion: true` in `.pm/config.json`: offer a positioning map (two axes, user chooses dimensions).

### Cost Guardrail

Before running batch SEO calls across multiple competitors, estimate the request count and show:

> "This will make approximately {N} SEO API calls across {M} competitors. Estimated cost: ~${X}. Proceed?"

Only continue after explicit confirmation.

---

## Topic Mode (`/pm:research {topic}`)

For targeted deep dives not covered by landscape or competitor profiling.

### Flow

1. **Check existing knowledge.** Read `pm/research/index.md` if it exists. Check `pm/landscape.md` and `pm/strategy.md` for relevant context.
2. **Check strategy alignment.** If `pm/strategy.md` exists, note how the topic relates to current priorities.
3. **Web search + SEO.** Search for the topic directly. Use `getKeywords` if SEO configured. Fill gaps with follow-up searches.
4. **Write findings** to `pm/research/{topic-slug}/findings.md`:

```markdown
---
type: topic-research
topic: {Topic Name}
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources:
  - url: ...
    accessed: YYYY-MM-DD
---

# {Topic Name}

## Summary
2-3 sentences. The key answer to "what did we learn?"

## Findings
Numbered findings with supporting evidence and source references.

## Implications
What this means for the product. Link to strategy sections if relevant.

## Open Questions
What this research did NOT answer.
```

5. **Update `pm/research/index.md`** — add entry with topic, date, one-line summary, link to findings.

---

## SEO Provider Invocation

All SEO calls go through the provider script via Bash:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/seo-provider.js {command} {args}
```

| Command | Args | Returns |
|---|---|---|
| `getKeywords` | `"{query}" --limit N` | Array of `{keyword, volume, difficulty}` |
| `getTraffic` | `"{domain}"` | `{monthly_visits, top_pages[]}` |
| `getBacklinks` | `"{domain}"` | `{domain_rating, backlink_count, top_referring[]}` |
| `getCompetitors` | `"{domain or product}"` | Array of `{name, domain, overlap_score}` |

**If provider is `"none"`:** Skip the call entirely. Proceed with web search. Do not error.

**If script returns `{"error": "..."}`:** Display the error message to the user, note it in the output file under Sources, and continue research without SEO data.

---

## Research Rules

1. Always check existing `pm/` knowledge before running new searches. Do not duplicate what is already documented.
2. Save findings with full source URLs and access dates.
3. Update existing files in place. Never create duplicate research files for the same topic.
4. No artificial limit on search depth — follow threads until the question is genuinely answered or the sources become circular.
5. Distinguish facts (sourced) from inferences (labeled "Hypothesis:") in all output files.
6. When a source contradicts existing knowledge, note the conflict explicitly. Do not silently overwrite.
