# Template Schema: list

The `list` template renders a page with a header, optional content-before block, and one or more sections of items (cards or rows). Used by competitor lists, research topic lists, shipped items, and proposals.

## Rendered by

`renderTemplate('list', data)` or `renderListTemplate(data)` in `scripts/server.js`

## Data Contract

```js
{
  breadcrumb:    '<a href="/kb">&larr; Knowledge Base</a>', // String, optional — raw HTML breadcrumb
  title:         'Research',                                 // String, required
  subtitle:      '3 topics',                                 // String, optional
  contentBefore: '<div class="markdown-body">...</div>',     // String, optional — HTML before sections
  sections: [                                                // Array of section objects
    {
      title:      'Topics',                  // String, optional — section heading
      count:      '3 topics',                // String, optional — shown next to title
      items:      ['<article>...</article>'], // Array<string>, required — raw HTML items
      layout:     'cards',                   // String, optional — 'cards' or 'rows'
      itemsClass: 'card-grid'               // String, optional — override container CSS class
    }
  ],
  emptyState: '<div class="empty-state">...</div>' // String, optional — shown when all sections have 0 items and no contentBefore
}
```

## Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `breadcrumb` | `string` | no | Raw HTML breadcrumb link (not an array like detail templates). |
| `title` | `string` | yes | Page heading. |
| `subtitle` | `string` | no | Subheading with counts or summary. |
| `contentBefore` | `string` | no | HTML rendered between the header and sections (e.g., landscape inline preview). |
| `sections` | `Array<Section>` | yes | Content sections. Sections with 0 items are skipped. |
| `emptyState` | `string` | no | HTML shown when total items across all sections is 0 and `contentBefore` is absent. |

### Section Object

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | no | Section label. |
| `count` | `string` | no | Count badge shown next to title. |
| `items` | `Array<string>` | yes | Raw HTML strings, one per item. |
| `layout` | `string` | no | `'cards'` uses `card-grid` container, otherwise uses `item-list`. |
| `itemsClass` | `string` | no | Override the container class (e.g., `proposal-grid`, `shipped-items`). |

## Usage: Competitor List

Route: `/kb?tab=competitors`

Source: Each subdirectory under `{pm_dir}/competitors/` with a `profile.md` file.

The handler reads `profile.md` from each competitor directory, extracts the `company` or `name` field from frontmatter, detects the category from the body, and counts how many of the 5 expected files are present. Each competitor becomes a card.

### Card Anatomy (competitors)

```html
<a href="/competitors/{slug}" class="competitor-card">
  <div class="competitor-name">{Company Name}</div>
  <div class="competitor-category">{Category}</div>
  <span class="competitor-view-link">View profile</span>
</a>
```

### Expected File Structure

```
{pm_dir}/competitors/
  acme/
    profile.md      <- required for the card to appear
    features.md     <- counted in badge
    api.md          <- counted in badge
    seo.md          <- counted in badge
    sentiment.md    <- counted in badge
```

## Usage: Research Topic List

Route: `/kb?tab=research`

Source: Each subdirectory under `{pm_dir}/research/` with a `findings.md` file.

The handler reads `findings.md`, calls `buildTopicMeta()` to extract the topic name, origin badge, evidence count, and staleness. Each topic becomes a card.

### Card Anatomy (research topics)

```html
<article class="card">
  <h3><a href="/research/{slug}">{Topic Name}</a></h3>
  <p class="meta">{subtitle: e.g., "External research"}</p>
  <div class="card-footer">
    <div class="topic-badges">
      <span class="badge badge-origin-external">External</span>
    </div>
    <a href="/research/{slug}" class="view-link">View</a>
  </div>
</article>
```

### Expected File Structure

```
{pm_dir}/research/
  checkout-optimization/
    findings.md     <- required for the card to appear
  pricing-models/
    findings.md
```

## CSS Classes in Output

| Class | Element | Purpose |
|---|---|---|
| `list-template` | wrapper div | Page container |
| `page-header` | div | Title and subtitle area |
| `section` | section | Each item section |
| `section-header` | div | Section title and count |
| `section-title` | span | Section heading text |
| `section-count` | span | Item count badge |
| `card-grid` | div | CSS grid container for cards (default for `layout: 'cards'`) |
| `item-list` | div | Flex column container for rows (default) |
| `card` | article | Individual card in card grid |
| `empty-state` | div | Empty state message |

## How to Add a New Template Type

See the guide in `references/templates/detail.md`.
