# Competitor Profiling Methodology

This guide is followed by both the parent `pm:research` skill (inline profiling) and researcher subagents (parallel profiling). Each competitor gets its own directory at `{pm_dir}/evidence/competitors/{slug}/` containing five files.

---

## Directory Structure per Competitor

```
{pm_dir}/evidence/competitors/{slug}/
  profile.md     — company overview, positioning, pricing, strengths/weaknesses
  features.md    — actual product capabilities by domain
  api.md         — API surface, data model, integrations
  seo.md         — keywords, traffic, content strategy
  sentiment.md   — review themes, complaints, praise, churn signals
```

Never write to `{pm_dir}/evidence/competitors/index.md` — that is owned by the parent skill.

---

## profile.md

### What to Research

- **Marketing site:** Homepage headline, sub-headline, hero CTA. What problem do they lead with? What outcome do they promise?
- **About page:** Founding year, founding story, mission statement, stated customer base.
- **Press and announcements:** Recent fundraising, acquisitions, major product launches. Crunchbase, TechCrunch, their own blog.
- **Pricing page:** Tier names, tier limits (seats, records, features), price points. Screenshot the page mentally — note what they hide behind "contact sales."
- **Positioning:** Who is the stated ICP? What is the primary differentiation claim? What category are they trying to own?
- **Strengths and weaknesses:** Based on what you have observed, not marketing claims.

### Frontmatter

```markdown
---
type: competitor-profile
company: {Company Name}
slug: {slug}
domain: {domain.com}
profiled: YYYY-MM-DD
sources:
  - url: ...
    accessed: YYYY-MM-DD
---
```

### Structure

```markdown
# {Company Name} — Profile

## Overview
Founded: {year} | HQ: {location} | Stage: {seed/series X/public}
One sentence on what they do and who for.

## Positioning
- **Category claim:** What they call their product category.
- **Primary ICP:** Industry, company size, role.
- **Differentiation claim:** The core "we're different because..." from their site.
- **Tone:** How they write — enterprise formal, startup casual, technical, etc.

## Pricing

| Tier | Price | Key Limits | Gating Factor |
|---|---|---|---|
| Free/Starter | $0 | ... | ... |
| Growth | $X/mo | ... | ... |
| Enterprise | Contact | ... | ... |

Note: pricing observed on YYYY-MM-DD. SaaS pricing changes frequently.

## Strengths
- ...

## Weaknesses
- ...

## Notable Signals
Anything that doesn't fit elsewhere: recent pivots, exec changes, unusual positioning choices.
```

---

## features.md

### What to Research

Go to their support docs, help center, and changelog — NOT the marketing site. Marketing claims capability; docs prove it.

Sources to check:
- `{domain}/docs`, `{domain}/help`, `help.{domain}`, `support.{domain}`
- Changelog or "What's new" page (reveals actual recent investment)
- YouTube channel walkthroughs (shows UX, not just feature names)
- G2 feature grids (community-validated capability tags)

Categorize features by domain. Use consistent domain names across competitors so the matrix in `index.md` is easy to build.

### Frontmatter

```markdown
---
type: competitor-features
company: {Company Name}
slug: {slug}
profiled: YYYY-MM-DD
sources:
  - url: ...
    accessed: YYYY-MM-DD
---
```

### Structure

```markdown
# {Company Name} — Features

## {Domain: e.g., "Scheduling"}
- Feature name: brief description of actual capability.
- Feature name: ...

## {Domain: e.g., "Reporting"}
- ...

## {Domain: e.g., "Mobile"}
- ...

## Recent Changelog Highlights
- {Date}: {What shipped} — signals where they are actively investing.
- ...

## Capability Gaps (observed)
Features commonly expected in this category that are absent or underdeveloped.
```

---

## api.md

Follow the full methodology in `skills/research/api-analysis.md`.

Summary of what to produce:

```markdown
---
type: competitor-api
company: {Company Name}
slug: {slug}
profiled: YYYY-MM-DD
sources:
  - url: ...
    accessed: YYYY-MM-DD
---

# {Company Name} — API

## API Availability
Public / Partner-only / Undocumented / None

## Auth Model
REST + API key / OAuth 2.0 / JWT / etc.

## Core Entity Model
The primary objects exposed: what they are, what they contain.

## Endpoint Coverage
Major resource groups and what CRUD operations are available.

## Webhooks
Supported events, payload format, retry behavior.

## Rate Limits
Known limits, header names, upgrade path.

## SDKs and Integrations
Official SDKs (languages), native integrations, marketplace connectors.

## Architectural Signals
What the API surface reveals about their product architecture and data model maturity.
```

---

## seo.md

### What to Research

Run the following SEO calls based on the configured provider in `{pm_state_dir}/config.json` (skip if provider is `"none"`):

**If `"ahrefs-mcp"`:** Use Ahrefs MCP tools directly. Call `mcp__ahrefs__doc` for each tool before first use to get the schema.
- `site-explorer-metrics` — organic traffic, keyword count, traffic value for `{domain}`
- `site-explorer-organic-keywords` — top 30 keywords by traffic for `{domain}` (with position, volume, page URL)
- `site-explorer-top-pages` — top 10 pages by traffic for `{domain}` (reveals content strategy focus)
- `site-explorer-metrics-by-country` — traffic by country for `{domain}` (reveals geographic focus and SEA presence)
- `site-explorer-backlinks-stats` — backlink and referring domain counts for `{domain}`
- `site-explorer-organic-competitors` — who else competes for the same keywords (discovers adjacent competitors)

Supplement with web search for content strategy signals: blog cadence, content categories, guest post patterns, link-building plays.

### Frontmatter

```markdown
---
type: competitor-seo
company: {Company Name}
slug: {slug}
profiled: YYYY-MM-DD
seo_data_available: true/false
sources:
  - url: ...
    accessed: YYYY-MM-DD
---
```

### Structure

```markdown
# {Company Name} — SEO

## Traffic Overview
Monthly visits: {N} | Domain rating: {N} | Est. organic traffic: {N}
(Source: {provider}, accessed YYYY-MM-DD)

## Top Organic Keywords

| Keyword | Volume | Position | Page |
|---|---|---|---|
| ... | ... | ... | ... |

## Top Pages by Traffic
1. {URL} — {estimated visits/mo} — {topic}
2. ...

## Backlink Profile
Total backlinks: {N} | Referring domains: {N}
Notable referring domains: ...

## Traffic by Country

| Country | Organic Traffic | % of Total |
|---|---|---|
| ... | ... | ... |

Geographic concentration and presence in target markets.

## Organic Competitors

| Competitor Domain | Common Keywords | Keyword Overlap |
|---|---|---|
| ... | ... | ... |

Domains competing for the same organic keyword space. May reveal adjacent competitors not found via web search.

## Content Strategy Signals
- Blog cadence: {X posts/month, topics covered}
- SEO plays: {long-tail focus / comparison pages / integration landing pages / etc.}
- Content gaps: Topics they are NOT covering that have search demand.
```

---

## sentiment.md

Follow the full methodology in `skills/research/review-mining.md`.

Summary of what to produce:

```markdown
---
type: competitor-sentiment
company: {Company Name}
slug: {slug}
profiled: YYYY-MM-DD
review_count_sampled: {N}
sources:
  - platform: G2
    url: ...
    accessed: YYYY-MM-DD
  - platform: Capterra
    url: ...
    accessed: YYYY-MM-DD
---

# {Company Name} — Sentiment

## Overall Sentiment
Rating: {X.X}/5 on G2 ({N} reviews) | {X.X}/5 on Capterra ({N} reviews)
Trend: improving / stable / declining (based on recency-weighted sample)

## Top Praise Themes
1. {Theme}: summary, representative quote.
2. ...

## Top Complaint Themes
1. {Theme}: summary, representative quote.
2. ...

## High-Severity Signals
Complaints involving data integrity, security, billing, or support failure. Even if low-frequency, these reveal risk posture.

## Support Quality Signals
What reviewers say about support responsiveness, quality, onboarding.

## Churn Signals
Reasons reviewers cite for switching away or considering alternatives.

## Feature Requests (recurring)
Features users consistently ask for that are absent.

## Reddit / Community Signals
Themes from r/[industry] or relevant forums. More candid than review sites.

## Analyst Notes
Inferences drawn from the data beyond what is directly stated. Label as "Inference:" to distinguish from sourced findings.
```

---

## Profiling Checklist

Before marking a competitor complete, verify all five files exist and contain:

- [ ] `profile.md` — pricing table complete, strengths/weaknesses present
- [ ] `features.md` — at least 3 domains covered, changelog section present
- [ ] `api.md` — auth model documented, entity model present (or "No public API" noted)
- [ ] `seo.md` — top keywords table present (or "SEO data unavailable" noted with reason)
- [ ] `sentiment.md` — at least 2 praise themes and 2 complaint themes present
