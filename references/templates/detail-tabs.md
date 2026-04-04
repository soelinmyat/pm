# Template Schema: detail-tabs

The `detail-tabs` template renders a detail page with tabbed content panels. Used by competitor detail pages where each section (profile, features, api, seo, sentiment) becomes a tab.

## Rendered by

`renderTemplate('detail-tabs', data)` in `scripts/server.js`

## Data Contract

```js
{
  breadcrumb: [
    { label: 'Knowledge Base', href: '/kb?tab=competitors' },
    { label: 'Acme Corp' }
  ],
  title:      'Acme Corp',             // String, required
  titlePrefix: '',                      // String, optional
  subtitle:   '',                       // String, optional
  metaBadges: [
    { html: '<span class="meta-item">SaaS</span>' },
    { html: '<span class="meta-item">5/5 sections</span>' }
  ],
  actionHint: '/pm:refresh acme',       // String, optional
  tabs: [                               // Array of {id, label, html}
    { id: 'profile',   label: 'Profile',   html: '<div>...</div>' },
    { id: 'features',  label: 'Features',  html: '<div>...</div>' },
    { id: 'api',       label: 'API',       html: '<div>...</div>' },
    { id: 'seo',       label: 'SEO',       html: '<div>...</div>' },
    { id: 'sentiment', label: 'Sentiment', html: '<div>...</div>' }
  ]
}
```

## Field Reference

### Shared Header Fields

See `references/templates/detail.md` for `breadcrumb`, `title`, `titlePrefix`, `subtitle`, `metaBadges`, `actionHint`.

### detail-tabs-Specific Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `tabs` | `Array<{id, label, html}>` | yes | One tab per content section. First tab is active by default. |
| `tabs[].id` | `string` | yes | URL-safe identifier (used in hash navigation: `#t0-profile`). |
| `tabs[].label` | `string` | yes | Tab button text. |
| `tabs[].html` | `string` | yes | Raw HTML content of the tab panel. |

## Competitor Directory Structure

The handler reads a 5-file directory for each competitor:

```
pm/competitors/{slug}/
  profile.md      -> tab: Profile
  features.md     -> tab: Features
  api.md          -> tab: API
  seo.md          -> tab: SEO
  sentiment.md    -> tab: Sentiment
```

Section keys are fixed: `profile`, `features`, `api`, `seo`, `sentiment`. Files that do not exist are omitted from tabs. The handler counts available files and shows `N/5 sections` in the meta bar.

For the full writing methodology and section structure of each file, see `skills/research/competitor-profiling.md`.

## File Frontmatter

### profile.md

```yaml
---
type: competitor-profile
company: Acme Corp
slug: acme
domain: acme.com
profiled: 2026-03-20
sources:
  - url: https://acme.com
    accessed: 2026-03-20
---
```

The `company` (or `name`) field becomes the page title. If absent, the directory slug is used.

### features.md / api.md / seo.md / sentiment.md

```yaml
---
type: competitor-features
company: Acme Corp
slug: acme
profiled: 2026-03-20
sources:
  - url: https://docs.acme.com
    accessed: 2026-03-20
---
```

## Example Content

### profile.md (minimal valid)

```markdown
---
type: competitor-profile
company: Acme Corp
slug: acme
profiled: 2026-03-20
---

# Acme Corp -- Profile

## Overview
Founded: 2020 | HQ: San Francisco | Stage: Series B
Project management for mid-market SaaS teams.

## Positioning
- **Category claim:** Modern work management platform
- **Primary ICP:** Engineering teams, 50-500 employees

## Pricing

| Tier | Price | Key Limits |
|---|---|---|
| Free | $0 | 5 users |
| Pro | $12/seat/mo | Unlimited |

## Strengths
- Fast iteration speed
- Strong API ecosystem

## Weaknesses
- No mobile app
- Limited reporting

## Notable Signals
Recently hired a VP of Enterprise Sales, suggesting upmarket push.
```

### features.md (minimal valid)

```markdown
---
type: competitor-features
company: Acme Corp
slug: acme
profiled: 2026-03-20
---

# Acme Corp -- Features

## Task Management
- Kanban boards with swimlanes
- Dependencies and blockers

## Recent Changelog Highlights
- 2026-03: Added bulk operations

## Capability Gaps
No native time tracking or resource planning.
```

## Rendering Behavior

- When only 1 tab exists, the tab bar is hidden and content renders directly.
- When 2+ tabs exist, a horizontal tab bar with keyboard navigation (Arrow keys, Enter, Space) is rendered.
- Hash navigation (`#t0-profile`) activates the corresponding tab on page load.
- The `profile.md` tab renders SWOT analysis blocks if the body contains `## Strengths` / `## Weaknesses` sections.

## CSS Classes in Output

| Class | Element | Purpose |
|---|---|---|
| `detail-page` | wrapper div | Page container |
| `tabs` | div | Tab bar container |
| `tab` | div | Individual tab button |
| `tab.active` | div | Currently selected tab |
| `tab-panel` | div | Tab content panel |
| `tab-panel.active` | div | Visible panel |
| `markdown-body` | div | Markdown content wrapper inside each panel |

## How to Add a New Template Type

See the guide in `references/templates/detail.md`.
