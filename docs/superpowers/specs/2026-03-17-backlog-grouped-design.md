# Backlog Grouped by Proposal — Design Spec

## Context

PM-030 from the Dashboard Proposal-Centric Redesign initiative. The backlog page defaults to a proposal-grouped view that gives every issue context about why it exists. Last issue in the initiative.

## Scope

- Proposal-grouped view as default on `/backlog`
- Parent chain walk to find proposal ancestors
- View toggle ("By Proposal" | "Kanban") via `?view=` query param
- Proposal group headers with gradient swatch, title, issue count, status breakdown
- Standalone Issues section for orphaned items
- Existing kanban view preserved unchanged behind toggle

## Architecture

### Data flow: `buildBacklogGrouped(pmDir)`

Returns grouped HTML string. Steps:

0. If backlog directory is empty or missing, return the existing empty-state HTML immediately (no grouping logic)
1. Scan `pm/backlog/*.md` — build `items` map: `slug → { data, parent, children }`
2. Scan `pm/backlog/proposals/*.meta.json` — build `proposals` set of known proposal slugs
3. For each item, walk parent chain (max depth 10):
   - If `parent` matches a proposal slug → group under that proposal
   - If `parent` matches another backlog item → follow that item's parent
   - If chain ends without proposal → "Standalone"
4. Build groups: `{ proposalSlug → [items] }` + standalone array
5. For each proposal group: read meta via `readProposalMeta()` for gradient + title
6. Render groups as always-expanded sections (not collapsible — link headers navigate to proposal), standalone at bottom
7. Within each group: render root-level items first, then direct children sorted immediately after their parent (parent → children ordering)

### Group rendering

Each proposal group:
```html
<div class="proposal-group">
  <a href="/proposals/{slug}" class="group-header">
    <div class="group-gradient" style="background: {gradient}"></div>
    <div class="group-title">{proposal title}</div>
    <div class="group-count">{N} issues — {status breakdown}</div>
  </a>
  <div class="group-items">
    {rendered items — parent items at top, children indented with margin-left: 1.25rem}
  </div>
</div>
```

Dead proposals (no `.meta.json`): show slug as plain text, no gradient, no link.

Standalone section:
```html
<div class="proposal-group standalone">
  <div class="group-header standalone-header">
    <div class="group-title">Standalone Issues</div>
    <div class="group-count">{N} issues</div>
  </div>
  <div class="group-items">{items}</div>
</div>
```

### View toggle

```html
<div class="view-toggle">
  <a href="/backlog?view=proposals" class="toggle-btn {active if proposals}">By Proposal</a>
  <a href="/backlog?view=kanban" class="toggle-btn {active if kanban}">Kanban</a>
</div>
```

Server-side: `handleBacklog` checks `?view=` param. Default is `proposals`. `kanban` renders the existing kanban code unchanged. Both `view=proposals` and no `view` param are treated as the proposals-active state (toggle highlights correctly on initial load). Priority legend is shown only in kanban view (not in grouped view).

### Route change

Current `handleBacklog` is called for `urlPath === '/backlog'`. It needs access to the query param. The routing already parses `urlObj.searchParams` (from PM-029's KB implementation). Pass the `view` param to `handleBacklog`.

### Modify `handleBacklog(res, pmDir, view)`

```
if view === 'kanban':
  render existing kanban (unchanged)
else:
  render toggle + buildBacklogGrouped(pmDir)
```

Both views include the toggle bar at the top.

## CSS additions

```css
.view-toggle { display: flex; gap: 0; margin-bottom: 1rem; border: 1px solid var(--border);
  border-radius: 4px; overflow: hidden; width: fit-content; }
.toggle-btn { padding: 0.375rem 0.75rem; font-size: 0.75rem; font-weight: 500;
  color: var(--text-muted); background: var(--bg); text-decoration: none;
  border-right: 1px solid var(--border); }
.toggle-btn:last-child { border-right: none; }
.toggle-btn.active { background: var(--accent); color: #fff; }
.proposal-group { margin-bottom: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.group-header { display: flex; align-items: center; gap: 0.75rem;
  padding: 0.625rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border);
  text-decoration: none; color: var(--text); }
.group-header:hover { background: #f0f2f5; }
.group-gradient { width: 24px; height: 24px; border-radius: 4px; flex-shrink: 0; }
.group-title { font-weight: 600; font-size: 0.875rem; flex: 1; }
.group-count { font-size: 0.75rem; color: var(--text-muted); }
.group-items { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.375rem; }
.group-items .child-item { margin-left: 1.25rem; }
.standalone-header { background: #f0f0f0; }
.standalone-header:hover { background: #f0f0f0; cursor: default; }
```

## Error handling

| Condition | Behavior |
|-----------|----------|
| `proposals/` dir missing | All items go to Standalone |
| `.meta.json` corrupted | Dead proposal — slug as plain text |
| Circular parent chain | Max depth 10 safety → treat as Standalone |
| Item with parent pointing to itself | Caught by depth limit |
| `?view=` invalid value | Default to `proposals` |

## Security

- All titles, slugs escaped with `escHtml()`
- Gradient values through `sanitizeGradient()`
- Group header links use `encodeURIComponent(slug)`

## Testing plan

1. Backlog default view is proposal-grouped
2. Items grouped correctly under proposal ancestor
3. Parent chain walk: child of child finds proposal grandparent
4. Standalone section for items with no proposal ancestor
5. View toggle: `?view=kanban` renders existing kanban
6. View toggle: `?view=proposals` renders grouped view
7. Dead proposal: shows slug text, no gradient
8. Empty backlog: empty state unchanged
9. Status breakdown in group header (count of done/in-progress/etc)

## Files modified

- `scripts/server.js` — add CSS, `buildBacklogGrouped()`, modify `handleBacklog()` + route, update exports
- `tests/server.test.js` — 7-9 new tests

## Dependencies

- PM-026 (merged) — `readProposalMeta()`, `sanitizeGradient()`
- PM-031 (merged) — `/proposals/{slug}` for group header links
