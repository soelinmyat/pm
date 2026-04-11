# Template Schema: kanban

The `kanban` template renders a multi-column board with cards grouped by status. Used by the roadmap page.

## Rendered by

`renderTemplate('kanban', data)` or `renderKanbanTemplate(data)` in `scripts/server.js`

## Data Contract

```js
{
  title:    'Roadmap',                                      // String, required
  subtitle: "What's coming, what's in progress, and what just shipped", // String, optional
  legend:   '<div class="filter-bar">...</div>',            // String, optional — HTML above columns
  columns: [                                                 // Array of column objects
    {
      label:        'Groomed',             // String, required — column header
      status:       'groomed',             // String, optional — internal key
      items:        ['<a class="kanban-card">...</a>'], // Array<string> — card HTML
      totalCount:   12,                    // Number — total items (may exceed displayed)
      displayCount: 10,                    // Number — items actually shown
      cssClass:     '',                    // String, optional — extra class on column div
      hint:         '',                    // String, optional — hint HTML in column
      viewAllHref:  '/roadmap/shipped',    // String, optional — "View all" link
      viewAllLabel: 'shipped'              // String, optional — label for "View all"
    }
  ],
  emptyState: '<div class="empty-state">...</div>'  // String, optional
}
```

## Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | yes | Page heading. |
| `subtitle` | `string` | no | Subheading. |
| `legend` | `string` | no | Raw HTML rendered between header and board (e.g., filter bar). |
| `columns` | `Array<Column>` | yes | Board columns. |
| `emptyState` | `string` | no | Shown when all columns have 0 items. |

### Column Object

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | `string` | yes | Column header text (e.g., "Groomed", "In Progress", "Shipped"). |
| `status` | `string` | no | Internal status key. |
| `items` | `Array<string>` | yes | Raw HTML card strings. |
| `totalCount` | `number` | no | Total items in this status. Defaults to `items.length`. |
| `displayCount` | `number` | no | Number of items displayed (rest hidden behind "View all"). |
| `cssClass` | `string` | no | Extra CSS class on the column div (e.g., `shipped`). |
| `hint` | `string` | no | HTML hint displayed in the column body. |
| `viewAllHref` | `string` | no | URL for the "View all N items" overflow link. |
| `viewAllLabel` | `string` | no | Label noun for the overflow link (e.g., "shipped"). |

## Backlog Status Mapping

The roadmap handler maps backlog issue frontmatter `status` values to kanban columns:

| Frontmatter `status` | Kanban column | Column label |
|---|---|---|
| `idea` | `groomed` | Groomed |
| `drafted` | `groomed` | Groomed |
| `approved` | `groomed` | Groomed |
| `in-progress` | `in-progress` | In Progress |
| `done` | `shipped` | Shipped |

Column order: Groomed, In Progress, Shipped.

## Card Data (per backlog item)

The handler reads these frontmatter fields from each `{pm_dir}/backlog/{slug}.md` file:

| Field | Type | Used for |
|---|---|---|
| `title` | `string` | Card title text. Falls back to slug. |
| `status` | `string` | Column assignment via STATUS_MAP. Defaults to `idea`. |
| `id` | `string` | ID badge on card header (e.g., `PM-042`). |
| `priority` | `string` | Not displayed on kanban card (displayed on detail page). |
| `parent` | `string` | Items with a parent are hidden (sub-issues). |
| `labels` | `Array<string>` | Not displayed on kanban card (displayed on detail page). |
| `scope_signal` | `string` | Not displayed on kanban card (displayed on detail page). |
| `updated` | `string` | Sort order (descending). |
| `created` | `string` | Fallback for sort when `updated` is absent. |

### Card HTML

```html
<a class="kanban-card" href="/roadmap/{slug}">
  <div class="kanban-card-header">
    <span class="kanban-card-id">PM-042</span>
    <span class="kanban-card-sub">3 sub-issues</span>
  </div>
  <div class="kanban-card-title">Bulk Edit Support</div>
</a>
```

- The header div is only rendered if `id` or `subCount > 0`.
- Sub-issue count is derived from other items whose `parent` matches this item's slug.

## Column Caps and Overflow

- Each column shows at most 10 items (sorted by `updated` descending).
- If a column has more than 10 items, a "View all N {label}" link appears.
- Currently only the Shipped column has a `viewAllHref` (`/roadmap/shipped`).

## Example Frontmatter (produces a kanban card)

```yaml
---
title: Bulk Edit Support
status: drafted
id: PM-042
priority: high
updated: 2026-04-01
created: 2026-03-15
---
```

This item:
- Appears in the **Groomed** column (status `drafted` maps to `groomed`).
- Shows the ID badge `PM-042`.
- Is sorted by `updated: 2026-04-01`.

## CSS Classes in Output

| Class | Element | Purpose |
|---|---|---|
| `kanban-template` | wrapper div | Page container |
| `page-header` | div | Title and subtitle |
| `kanban` | div | Flex container for columns |
| `kanban-col` | div | Individual column |
| `kanban-col.shipped` | div | Shipped column (dimmed styling) |
| `kanban-col.col-empty` | div | Column with 0 items |
| `col-header` | div | Column label and count |
| `col-count` | span | Item count in column header |
| `col-body` | div | Card container within column |
| `col-hint` | div | Hint text in column |
| `kanban-card` | a | Individual card (linked to detail page) |
| `kanban-card-header` | div | Card header with ID badge and sub-count |
| `kanban-card-id` | span | Issue ID badge |
| `kanban-card-sub` | span | Sub-issue count |
| `kanban-card-title` | div | Card title text |
| `kanban-view-all` | a | "View all" overflow link |

## How to Add a New Template Type

See the guide in `references/templates/detail.md`.
