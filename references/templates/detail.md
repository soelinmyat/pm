# Template Schema: detail

The `detail` template renders a single-item detail page with breadcrumb navigation, title, meta badges, and sequential sections. Used by backlog issue detail pages and research topic detail pages.

## Rendered by

`renderTemplate('detail', data)` in `scripts/server.js`

## Data Contract

```js
{
  breadcrumb: [                    // Array of {label, href?} objects
    { label: 'Roadmap', href: '/roadmap' },
    { label: 'PM-042 My Feature' } // Last item has no href (current page)
  ],
  title:       'My Feature',       // String, required — page heading
  titlePrefix: '<span>PM-042</span>', // String, optional — raw HTML prepended to title
  subtitle:    '',                 // String, optional — shown below title
  metaBadges: [                    // Array of {html} objects — raw HTML badges
    { html: '<span class="badge badge-drafted">drafted</span>' },
    { html: '<span class="meta-item">high priority</span>' }
  ],
  actionHint:  '/pm:groom my-feature', // String, optional — click-to-copy command
  sections: [                      // Array of {title?, html} objects
    { title: 'Outcome', html: '<p>Users can bulk-edit items.</p>' },
    { title: 'Acceptance Criteria', html: '<ul class="detail-ac-list">...</ul>' },
    { title: null, html: '<div class="markdown-body">...</div>' }
  ]
}
```

## Field Reference

### Shared Header Fields (all detail-* templates)

| Field | Type | Required | Description |
|---|---|---|---|
| `breadcrumb` | `Array<{label, href?}>` | yes | Navigation trail. Last item is current page (no `href`). |
| `title` | `string` | yes | Page heading text. |
| `titlePrefix` | `string` | no | Raw HTML prepended before title text (e.g., ID badge). |
| `subtitle` | `string` | no | Subheading below the title. |
| `metaBadges` | `Array<{html}>` | no | Status badges, priority, dates. Separated by dot dividers. |
| `actionHint` | `string` | no | Slash command shown as click-to-copy in the meta bar. |

### detail-Specific Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `sections` | `Array<{title?, html}>` | yes | Content sections. `title` is uppercase label; `null` title renders content without a header. `html` is raw HTML string. |

## Backlog Issue Frontmatter

When a skill writes a backlog issue file (`{pm_dir}/backlog/{slug}.md`), the dashboard handler parses this frontmatter:

```yaml
---
title: Bulk Edit Support                  # Required — page title
status: drafted                           # Required — idea|drafted|approved|in-progress|done
id: PM-042                                # Optional — displayed as ID badge
priority: high                            # Optional — low|medium|high|critical
parent: parent-feature-slug               # Optional — slug of parent issue
outcome: "Users can edit multiple items"  # Optional — shown in Outcome section
acceptance_criteria:                       # Optional — array; if absent, parsed from ## Acceptance Criteria
  - Users can select multiple rows
  - Bulk status change works
children:                                  # Optional — array of child issue slugs
  - child-issue-1
  - child-issue-2
labels:                                    # Optional — array of label strings
  - api
  - mvp
scope_signal: small                        # Optional — size hint
updated: 2026-04-01                        # Optional — last modified date
created: 2026-03-15                        # Optional — creation date
---
```

### Allowed `status` Values

| Value | Kanban column | Meaning |
|---|---|---|
| `idea` | Groomed | Raw idea, not yet scoped |
| `drafted` | Groomed | Issue drafted with ACs |
| `approved` | Groomed | Reviewed and approved |
| `in-progress` | In Progress | Active development |
| `done` | Shipped | Completed |

## Content Structure

```markdown
---
title: Bulk Edit Support
status: drafted
id: PM-042
priority: high
outcome: "Users can edit multiple items at once"
acceptance_criteria:
  - Users can select multiple rows via checkboxes
  - Bulk status change applies to all selected items
  - Undo is available for 10 seconds after bulk action
updated: 2026-04-01
created: 2026-03-15
---

# Bulk Edit Support

Main body content in markdown. This is rendered as the final section
with no section title header.

## Acceptance Criteria

If `acceptance_criteria` is not in frontmatter, the handler parses
this section from the body instead. Each `- [ ]` or `- ` line becomes
an AC item.

- [ ] Users can select multiple rows via checkboxes
- [ ] Bulk status change applies to all selected items

## Wireframes

Link to wireframe HTML if one exists:

[Wireframe preview]({pm_dir}/backlog/wireframes/bulk-edit-support.html)
```

## CSS Classes in Output

| Class | Element | Purpose |
|---|---|---|
| `detail-page` | wrapper div | Page container (max-width 960px) |
| `detail-breadcrumb` | nav | Breadcrumb navigation |
| `detail-title` | h1 | Page title |
| `detail-id-badge` | span | Issue ID badge in title prefix |
| `detail-meta-bar` | div | Status badges and action hint row |
| `detail-section` | section | Each content section wrapper |
| `detail-section-title` | h2 | Section label (uppercase, muted) |
| `detail-ac-list` | ul | Acceptance criteria checklist |
| `detail-action-hint` | div | Click-to-copy command container |

## How to Add a New Template Type

1. **Define the render function** in `scripts/server.js` following the pattern of `renderDetailTemplate(data)`. Accept a single `data` object, return an HTML string.
2. **Register it** in the `renderTemplate()` switch statement with a unique type key.
3. **Export it** in `module.exports` if direct testing is needed.
4. **Write a handler** that parses source files (frontmatter + body), builds the data object, and calls `renderTemplate(type, data)`.
5. **Add a route** in `routeDashboard()` that maps a URL pattern to the handler.
6. **Document the schema** by creating a new file in `references/templates/{type}.md` following this format.
7. **Add tests** in `tests/server.test.js` that create temp files, start the dashboard, and assert the rendered HTML contains expected CSS classes and content.
