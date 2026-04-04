# Template Schema: detail-toc

The `detail-toc` template renders a detail page with an auto-generated table of contents derived from h2 headings. Used by research topic detail pages and the landscape overview page.

## Rendered by

`renderTemplate('detail-toc', data)` in `scripts/server.js`

## Data Contract

```js
{
  breadcrumb: [
    { label: 'Knowledge Base', href: '/kb' }
  ],
  title:      'Market Landscape',         // String, required
  titlePrefix: '',                         // String, optional
  subtitle:   '',                          // String, optional
  metaBadges: [
    { html: '<span class="badge badge-fresh">Fresh</span>' }
  ],
  actionHint: '/pm:refresh',              // String, optional
  toc: [                                   // Array of {text, slug}
    { text: 'Market Overview', slug: 'market-overview' },
    { text: 'Key Players',    slug: 'key-players' }
  ],
  bodyHtml: '<h2 id="market-overview">Market Overview</h2><p>...</p>'
  // String, required — pre-rendered HTML body
}
```

## Field Reference

### Shared Header Fields

See `references/templates/detail.md` for `breadcrumb`, `title`, `titlePrefix`, `subtitle`, `metaBadges`, `actionHint`.

### detail-toc-Specific Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `toc` | `Array<{text, slug}>` | yes | Table of contents entries. Each links to an `id` attribute on an h2 in the body. |
| `toc[].text` | `string` | yes | Display text for the TOC link. |
| `toc[].slug` | `string` | yes | URL-safe anchor (e.g., `market-overview`). Must match an `id` attribute in `bodyHtml`. |
| `bodyHtml` | `string` | yes | Pre-rendered HTML content. h2 elements should have `id` attributes matching the TOC slugs. |

## How TOC is Generated

The handler (not the template) builds the TOC from the markdown source:

1. Extract all `## Heading` lines from the markdown body.
2. For each heading, strip formatting characters (`*`, `_`, `` ` ``, `#`) to get plain text.
3. Slugify: lowercase, replace non-alphanumeric runs with `-`, trim leading/trailing dashes.
4. Pass the `{text, slug}` array as `toc`.
5. After rendering the markdown body to HTML, inject `id` attributes on the matching `<h2>` elements.

The template renders the TOC as a horizontal navigation bar (`<nav class="tabs">`). A scroll-spy script highlights the active TOC link based on scroll position.

## Variant: Landscape Page

Route: `/kb?tab=landscape`

Source file: `pm/landscape.md`

### Frontmatter

```yaml
---
type: landscape
created: 2026-03-12
updated: 2026-03-25
sources:
  - url: https://example.com/report
    accessed: 2026-03-12
---
```

### Content Structure

```markdown
---
type: landscape
created: 2026-03-12
updated: 2026-03-25
sources:
  - url: https://example.com/report
    accessed: 2026-03-12
---

# Market Landscape: AI Dev Tools

<!-- stat: $4.2B, TAM -->
<!-- stat: 34%, YoY Growth -->
<!-- stat: 2,400, Monthly searches -->

Stat comments go directly after the h1. The dashboard parses
`<!-- stat: {value}, {label} -->` and renders a stat card row.

## Market Overview
2-3 paragraph summary of the market.

## Key Players

| Company | Positioning | Primary Segment | Notable |
|---|---|---|---|
| [Acme](https://acme.com) | Enterprise PM | Enterprise | IPO 2025 |

## Keyword Landscape

| Keyword | Volume | Difficulty | Notes |
|---|---|---|---|

## Market Segments
Named segments with a 1-sentence description each.

## Market Positioning Map

<!-- positioning: company, x (0-100, Low-end to High-end), y (0-100, Niche to Broad), traffic, segment-color -->
<!-- Acme, 85, 30, 311655, horizontal -->
<!-- Beta Co, 20, 60, 3091, mid-market -->
<!-- Our Product, 25, 50, 0, self -->

The dashboard parses positioning comments and renders a bubble chart.
Bubble size = organic traffic, color = segment.

Segment color keys: `enterprise`, `mid-market`, `smb`, `horizontal`, `self`.

## Initial Observations
- Observation 1
- Observation 2
```

### Special Rendering

- **Stat comments** (`<!-- stat: value, label -->`): Parsed by `parseStatsData()`, rendered as a card row after the h1.
- **Positioning comments** (`<!-- positioning: ... -->`): Parsed by `parsePositioningData()`, rendered as an SVG bubble chart.
- **Mermaid blocks**: Code blocks with language `mermaid` are rendered by the Mermaid.js library loaded in the page shell.

## Variant: Research Topic Page

Route: `/research/{topic}`

Source file: `pm/research/{topic}/findings.md`

### Frontmatter

```yaml
---
type: topic-research
topic: Checkout Optimization
created: 2026-03-15
updated: 2026-03-20
source_origin: external
sources:
  - url: https://example.com/study
    accessed: 2026-03-15
evidence_count: 17
segments:
  - SMB
confidence: high
---
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | yes | Always `topic-research`. |
| `topic` | `string` | yes | Human-readable topic name (used as page title). |
| `created` | `string` | yes | `YYYY-MM-DD` creation date. |
| `updated` | `string` | no | `YYYY-MM-DD` last updated date. |
| `source_origin` | `string` | no | `external`, `internal`, or `mixed`. Defaults to `external`. |
| `sources` | `Array<{url, accessed}>` | no | Source references. |
| `evidence_count` | `number` | no | Count of evidence records (for internal/mixed topics). |
| `segments` | `Array<string>` | no | Customer segments represented in the evidence. |
| `confidence` | `string` | no | `low`, `medium`, or `high`. |

### Content Structure

```markdown
---
type: topic-research
topic: Checkout Optimization
created: 2026-03-15
updated: 2026-03-20
source_origin: external
sources:
  - url: https://example.com/study
    accessed: 2026-03-15
---

# Checkout Optimization

## Summary
2-3 sentences summarizing the key findings.

## Findings
1. Finding one with supporting evidence.
2. Finding two with data points.

## Strategic Relevance
How this topic connects to current product strategy.

## Implications
What this means for the product roadmap.

## Open Questions
What the research did NOT answer.

## Sources
- https://example.com/study -- accessed 2026-03-15
```

### Rendering Notes

The research topic handler uses the `detail` template (not `detail-toc`) because it splits the body at `## Sources` / `## References` into two explicit sections: "Findings" and "Sources". The landscape handler uses `detail-toc` because the full body renders as one scrollable document with a TOC.

## CSS Classes in Output

| Class | Element | Purpose |
|---|---|---|
| `detail-page` | wrapper div | Page container |
| `tabs` | nav | TOC navigation bar (horizontal links) |
| `tab` | a | Individual TOC link |
| `tab.active` | a | Currently visible section (set by scroll spy) |
| `markdown-body` | div | Body content wrapper |

## How to Add a New Template Type

See the guide in `references/templates/detail.md`.
