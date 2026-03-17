# Proposal Gallery Page — Design Spec

## Context

PM-028 from the Dashboard Proposal-Centric Redesign initiative. The proposal gallery makes groom proposals the hero artifact of the PM dashboard. Depends on PM-026 (metadata sidecar helpers, merged).

## Scope

- New `/proposals` route showing all proposals as a card grid
- Minimal `/proposals/{slug}` handler serving raw proposal HTML files (lightweight, PM-031 upgrades to iframe-in-dashboard)
- Modified home page showing 6 most recent proposals above KB stats with persistent "View all" link
- Draft proposal cards from active groom state with resume hint
- Empty state when no proposals exist

## Architecture

### Shared helper: `buildProposalCards(pmDir, limit)`

Returns `{ cardsHtml, totalCount }`. Both `/proposals` and `/` call this.

**Data flow:**
1. Scan `pm/backlog/proposals/` for `*.meta.json` files
2. For each file, call `readProposalMeta(slug, pmDir)` — skip if null (corrupted/missing)
3. Call `readGroomState(pmDir)` — if active session exists, create a draft card entry
4. Sort all entries by date (newest first), draft pinned to front
5. Apply `limit` (6 for home, null for gallery)
6. Render each entry as card HTML
7. Return `{ cardsHtml, totalCount }` where totalCount is pre-limit count

**Card rendering per entry:**

Completed card:
```html
<a href="/proposals/{slug}" class="card proposal-card">
  <div class="card-gradient" style="background: {meta.gradient}"></div>
  <h3>{meta.title}</h3>
  <p class="meta">{stalenessLabel}</p>
  <div class="card-footer">
    <div><span class="badge badge-ready">{meta.verdictLabel}</span> <span class="badge">{meta.issueCount} issues</span></div>
    <span class="view-link">View →</span>
  </div>
</a>
```

Draft card:
```html
<div class="card proposal-card draft">
  <div class="card-gradient draft-gradient"></div>
  <h3>{groomState.topic}</h3>
  <p class="meta">Grooming since {groomState.started}</p>
  <div class="card-footer">
    <span class="badge badge-draft">Draft — {phaseLabel}</span>
  </div>
  <p class="action-hint">Resume with <code>/pm:groom</code></p>
</div>
```

### Route: `handleProposalsPage(res, pmDir)`

```
GET /proposals → 200
  calls buildProposalCards(pmDir, null)
  if no cards → empty state with /pm:groom hint
  wraps in dashboardPage('Proposals', '/proposals', body)
```

### Home page modification: `handleDashboardHome(res, pmDir)`

After the groom session banner (PM-027) and before the KB card-grid:
```
calls buildProposalCards(pmDir, 6)
if cardsHtml is not empty:
  render "Recent Proposals" section heading
  render cards
  always render "View all proposals →" link to /proposals (persistent entry point)
```

### CSS additions to DASHBOARD_CSS

```css
/* Proposal cards */
.proposal-card { position: relative; overflow: hidden; }
.proposal-card .card-gradient { height: 48px; }
.proposal-card.draft { border-style: dashed; border-color: #b8d4f0; cursor: default; opacity: 0.85; }
.proposal-card.draft:hover { box-shadow: var(--shadow-sm); transform: none; }
.draft-gradient { background: repeating-linear-gradient(45deg, #e8e8e8, #e8e8e8 10px, #f0f0f0 10px, #f0f0f0 20px); }
.badge-draft { background: #dbeafe; color: #1d4ed8; }
```

### Minimal detail handler: `handleProposalDetail(res, pmDir, slug)`

Serves the raw proposal HTML file at `/proposals/{slug}`. No dashboard chrome — just the standalone HTML. PM-031 will upgrade this to an iframe-in-dashboard experience.

```
GET /proposals/{slug} → 200 (serve raw HTML) or 404
  validate slug (no .., no /, no \)
  resolve path: pm/backlog/proposals/{slug}.html
  path.resolve + startsWith containment check (matches readProposalMeta pattern)
  if file exists → serve with Content-Type text/html
  if not → 404 with back link to /proposals
```

This ensures completed proposal cards are always navigable, even before PM-031 ships.

### Routing additions

In `routeDashboard()`:
```javascript
} else if (urlPath === '/proposals') {
  handleProposalsPage(res, pmDir);
} else if (urlPath.startsWith('/proposals/')) {
  const slug = urlPath.slice('/proposals/'.length).replace(/\/$/, '');
  handleProposalDetail(res, pmDir, slug);
}
```

### Home page "View all" link

Always show "View all proposals →" link below the proposal card grid on the home page (not just when >6). This provides a persistent entry point to `/proposals` for users with ≤6 proposals, addressing the nav discoverability gap until PM-029 merges and adds the Proposals nav item.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| `proposals/` dir missing | Empty state, no error |
| `.meta.json` corrupted | Skip that card (readProposalMeta returns null) |
| `.meta.json` missing required fields | Card renders with fallback: title from slug, no badge |
| Groom state missing | No draft card, only completed proposals |
| Groom state corrupted | No draft card (readGroomState returns null) |
| No proposals AND no groom state | Empty state with `/pm:groom` hint |

## Security

- All user-controlled content (title, verdictLabel, topic) escaped with `escHtml()` before interpolation
- Gradient values from `.meta.json` injected into `style=` attribute — validate with regex (`/^linear-gradient\(/`). If null/undefined/invalid, fall back to a neutral gray (`#e5e7eb`)
- Slug validation via `readProposalMeta()` path traversal checks (already implemented in PM-026)

## Testing Plan

1. **GET /proposals with proposals** — returns 200, cards rendered with title, gradient, badges
2. **GET /proposals empty** — returns 200, empty state with `/pm:groom` hint
3. **GET /proposals with draft** — draft card shown with dashed border class, phase badge, resume hint
4. **GET /proposals sort order** — newest first
5. **GET /proposals/{slug} serves proposal HTML** — returns 200 with file content
6. **GET /proposals/{slug} with path traversal** — returns 404 or null
7. **GET /proposals/{slug} for missing file** — returns 404 with back link
8. **Home page with proposals** — shows proposal cards section above KB stats, "View all" link always present
9. **Home page caps at 6** — only 6 cards when more exist
10. **Home page without proposals** — no proposal section rendered
11. **Gradient sanitization** — reject non-gradient values, fallback to neutral gray

## Files Modified

- `scripts/server.js` — add CSS, `buildProposalCards()`, `handleProposalsPage()`, `handleProposalDetail()`, modify `handleDashboardHome()`, add routes, update exports
- `tests/server.test.js` — 9-11 new tests

## Out of Scope

- Full `/proposals/{slug}` detail view with dashboard chrome + iframe (PM-031 — this PR adds minimal raw file serve)
- Proposal status workflow
- Real-time updates via WebSocket

## Dependencies

- **PM-026** (merged) — provides `readProposalMeta()`, `readGroomState()`, `proposalGradient()`
- **PM-029** (PR open) — adds Proposals nav item. Until merged, `/proposals` is reachable via home page "View all" link
