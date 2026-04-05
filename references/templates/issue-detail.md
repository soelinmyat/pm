# Template Schema: issue-detail

The `issue-detail` template renders a backlog item with a two-column layout: main content (left) and metadata sidebar (right). Used by `handleBacklogItem()` for all backlog issues.

## Rendered by

`renderTemplate('issue-detail', data)` in `scripts/server.js`

## Data Contract

```javascript
{
  // Standard detail header fields (shared with 'detail' template)
  breadcrumb: [{ label, href? }],
  title: string,
  titlePrefix: string,   // HTML for ID badge
  subtitle: string,
  metaBadges: [{ html }],
  actionHint: string,     // Click-to-copy command

  // Main content sections (left column)
  sections: [{ title?, html }],

  // Sidebar metadata (right column)
  sidebarFields: [{
    label: string,       // Field name (e.g., "Status", "Priority")
    html: string,        // Value HTML (can include badges, links)
  }],

  // Sidebar linked items
  sidebarLinked: [{
    href: string,        // URL
    label: string,       // Link text
    badge?: string,      // Optional badge text (e.g., "Parent", "Research")
  }],
}
```

## Layout

Two-column grid: `grid-template-columns: 1fr 280px` with `gap: var(--space-12)`.

- **Left column:** Title, meta bar, content sections (Outcome, Acceptance Criteria, wireframe embed, markdown body)
- **Right column:** Sticky sidebar card with metadata fields and linked items

Collapses to single column at `max-width: 768px` with sidebar appearing first (via `order: -1`).

## CSS Classes

| Class | Purpose |
|-------|---------|
| `.issue-detail-page` | Container — wider max-width (1080px) |
| `.issue-two-col` | Grid layout |
| `.issue-main-col` | Left content column |
| `.issue-sidebar` | Right sidebar (sticky) |
| `.sidebar-card` | Card wrapping all sidebar content |
| `.sidebar-field` | Single key-value metadata row |
| `.sidebar-label` | Field name |
| `.sidebar-value` | Field value |
| `.sidebar-section-label` | Group header (e.g., "Linked") |
| `.sidebar-linked-item` | Linked item row |
| `.sidebar-linked-badge` | Badge on linked item |
