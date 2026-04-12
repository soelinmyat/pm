---
name: SEO Provider Configuration
order: 6
description: SEO provider routing (ahrefs-mcp or none) and tool inventory shared across all research modes
---

## SEO Provider Invocation

Read `{pm_state_dir}/config.json` to determine the configured SEO provider. Route calls based on the provider:

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
