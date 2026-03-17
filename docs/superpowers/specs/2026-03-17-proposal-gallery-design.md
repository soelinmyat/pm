# Proposal Gallery Page — Design Spec

## Context

PM-028 from the Dashboard Proposal-Centric Redesign initiative. The proposal gallery makes groom proposals the hero artifact of the PM dashboard. Depends on PM-026 (metadata sidecar helpers, merged).

## Scope

- New `/proposals` route showing all proposals as a card grid
- Modified home page showing 6 most recent proposals above KB stats
- Draft proposal cards from active groom state
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
  if totalCount > 6: render "View all N proposals →" link to /proposals
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

### Routing addition

In `routeDashboard()`, add before the 404 fallback:
```javascript
} else if (urlPath === '/proposals') {
  handleProposalsPage(res, pmDir);
}
```

Note: `/proposals/{slug}` detail view is PM-031 (out of scope). For now, completed cards link to `/proposals/{slug}` which will 404 until PM-031 ships. This is acceptable — the gallery ships independently.

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
- Gradient values from `.meta.json` injected into `style=` attribute — must sanitize (strip anything that's not a valid CSS gradient pattern)
- Slug validation via `readProposalMeta()` path traversal checks (already implemented in PM-026)

## Testing Plan

1. **GET /proposals with proposals** — returns 200, cards rendered with title, gradient, badges
2. **GET /proposals empty** — returns 200, empty state with `/pm:groom` hint
3. **GET /proposals with draft** — draft card shown with dashed border class, phase badge
4. **GET /proposals sort order** — newest first
5. **Home page with proposals** — shows proposal cards section above KB stats
6. **Home page caps at 6** — shows "View all" link when > 6 proposals
7. **Home page without proposals** — no proposal section rendered
8. **buildProposalCards exported** — function is available for testing
9. **Gradient sanitization** — reject non-gradient values in style attribute

## Files Modified

- `scripts/server.js` — add CSS, `buildProposalCards()`, `handleProposalsPage()`, modify `handleDashboardHome()`, add route, update exports
- `tests/server.test.js` — 7-9 new tests

## Out of Scope

- `/proposals/{slug}` detail view (PM-031)
- Proposal status workflow
- Real-time updates via WebSocket
