# Proposal Gallery Page — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `/proposals` route shows all proposals as a card grid. Each card displays the proposal's hero gradient, title, verdict badges, issue count, and date. Draft proposals (from active groom state) appear with a dashed border and "Draft" badge showing the current phase. The home page shows the 6 most recent proposals; the `/proposals` page shows all.

**Architecture:** `routeDashboard()` routes `/proposals` to `handleProposalsPage()`, which calls `buildProposalCards(pmDir, null)` (no limit) to render all proposals. `buildProposalCards()` scans `pm/backlog/proposals/*.meta.json` for completed proposals and reads groom sessions via `readGroomState()` for drafts. `handleDashboardHome()` calls `buildProposalCards(pmDir, 6, groomSessions)` for the home page's "Recent Proposals" section.

**Tech Stack:** Node.js (server.js), node:test

**Current state:** All 11 acceptance criteria are already implemented in the codebase. All tests already exist and pass. This plan documents the existing implementation and confirms full coverage.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | No changes needed | All gallery logic already in place |
| `tests/server.test.js` | No changes needed | All gallery tests already in place |

---

## Pre-existing Implementation Inventory

The following AC items are **already implemented** in the current codebase and require no code changes:

### AC 1 — New `/proposals` route in `routeDashboard()`

**Status: Done** — `routeDashboard()` at `server.js:961` handles `urlPath === '/proposals'` at line 1030, dispatching to `handleProposalsPage(res, pmDir)` at line 1031. Sub-routes `/proposals/{slug}` and `/proposals/{slug}/raw` are handled at lines 1032-1055.

### AC 2 — `handleProposalsPage()` scans `pm/backlog/proposals/` for `*.meta.json`

**Status: Done** — `handleProposalsPage()` at `server.js:1693-1711` calls `buildProposalCards(pmDir, null)` which scans `path.resolve(pmDir, 'backlog', 'proposals')` at line 1380. Files are filtered to `*.meta.json` at line 1382, and each is read via `readProposalMeta(slug, pmDir)` at line 1385.

### AC 3 — Cards use existing `.card-grid` and `.card` CSS with proposal-specific additions

**Status: Done** — Cards are wrapped in `<div class="card-grid">` at line 1706. Each completed proposal card uses `class="card proposal-card"` (line 1400). Proposal-specific CSS at lines 728-739:
- `.proposal-card`: `position: relative; overflow: hidden`
- `.proposal-card .card-gradient`: 48px gradient strip at top with rounded top corners
- `.proposal-card h3`: title with top margin after gradient
- Verdict badges use `.badge .badge-ready` (line 1392)
- Issue count uses `.badge` (line 1395)

### AC 4 — Cards sorted by date (newest first)

**Status: Done** — `buildProposalCards()` at line 1424: `entries.sort((a, b) => b.date.localeCompare(a.date))`. Completed proposals use `meta.date` (line 1398). Draft proposals use date `'9999-99-99'` (line 1413), which sorts them to the top (pinned first).

### AC 5 — Draft proposals from `.pm/groom-sessions/` appear with dashed border and phase badge

**Status: Done** — `buildProposalCards()` reads groom sessions at line 1409 via `readGroomState(pmDir)` (which reads from `.pm/groom-sessions/*.md` with legacy fallback to `.pm/.groom-state.md`). Draft cards at lines 1415-1422 use:
- `class="card proposal-card draft"` — CSS at line 732 applies `border-style: dashed; border-color: #b8d4f0; cursor: default; opacity: 0.85`
- Draft hover effect neutralized at line 733: `box-shadow: var(--shadow-sm); transform: none`
- Phase badge: `<span class="badge badge-draft">Draft — ${phase}</span>` (line 1419)
- Draft cards are `<div>` elements (not `<a>`), so they are not clickable (line 1415)

### AC 6 — Data mapping: completed from `*.meta.json`, draft from groom state

**Status: Done** — Completed card data at lines 1383-1406:
- `meta.title` → card title (line 1387)
- `meta.gradient` → hero gradient via `sanitizeGradient()` (line 1388)
- `meta.date` → staleness display via `stalenessInfo()` (line 1389)
- `meta.verdictLabel` → verdict badge (line 1391)
- `meta.issueCount` → issue count badge (line 1394)

Draft card data at lines 1410-1422 via `groomSessionDisplay()`:
- `session.topic` → title (`d.topic`, line 1417)
- `session.phase` → badge label via `groomPhaseLabel()` (`d.phase`, line 1419)
- `session.started` → date (`d.started`, line 1418)

### AC 7 — Empty state with `/pm:groom` hint

**Status: Done** — `handleProposalsPage()` at lines 1696-1701 checks `totalCount === 0` and renders:
```html
<div class="empty-state">
  <h2>No proposals yet</h2>
  <p>Run <code>/pm:groom</code> to create your first proposal.</p>
</div>
```

### AC 8 — Clicking a completed card navigates to `/proposals/{slug}`

**Status: Done** — Completed cards are `<a href="/proposals/${slug}">` elements (line 1400). The `/proposals/{slug}` route at line 1032 dispatches to `handleProposalDetail()` (line 1661) which renders the proposal in a dashboard-framed iframe view.

### AC 9 — Home page shows 6 most recent proposals

**Status: Done** — `handleDashboardHome()` at line 1608 calls `buildProposalCards(pmDir, 6, groomSessions)`. The limit of 6 is applied at line 1426: `const limited = limit ? entries.slice(0, limit) : entries`. The section is wrapped in a "Recent Proposals" header with a "View all proposals" link to `/proposals` (lines 1613-1620). When `proposalCount === 0`, no section is rendered (line 1609).

### AC 10 — Proposal cards show "N issues" count

**Status: Done** — Issue count badge at lines 1394-1396:
```javascript
const issueHtml = typeof meta.issueCount === 'number'
  ? `<span class="badge">${meta.issueCount} issue${meta.issueCount !== 1 ? 's' : ''}</span>`
  : '';
```
Pluralization is handled: "1 issue" vs "N issues".

### AC 11 — Graceful handling when `pm/backlog/proposals/` does not exist

**Status: Done** — `buildProposalCards()` at line 1381: `if (fs.existsSync(proposalsDir))` guards the directory scan. When the directory does not exist, only groom sessions (if any) are included, or the entries array remains empty.

---

## Pre-existing Test Coverage

All test scenarios for this feature already exist in `tests/server.test.js`:

### Unit tests — `buildProposalCards()`

| Test | Line | What it verifies |
|------|------|-----------------|
| `sanitizeGradient` validates and rejects XSS | 1296 | Valid gradients pass through; null/undefined/empty/XSS/injection fall back to `#e5e7eb` |
| Cards sorted newest first | 1307 | Feature B (2026-03-17) appears before Feature A (2026-03-15) |
| Draft card pinned first with resume hint | 1322 | Draft appears before completed, has `draft` class, includes `/pm:groom {slug}` hint |
| Empty when no proposals | 1339 | Returns `totalCount: 0` and empty `cardsHtml` |
| Limit parameter respected | 1349 | 8 proposals with limit 3: `totalCount` is 8, newest 3 shown, oldest excluded |

### Integration tests — HTTP routes

| Test | Line | What it verifies |
|------|------|-----------------|
| `GET /proposals` with proposals returns card grid | 1368 | Status 200, title shown, gradient rendered |
| `GET /proposals` empty shows groom hint | 1385 | Status 200, `/pm:groom` hint in empty state |
| `GET /proposals/{slug}` renders dashboard-framed view | 1397 | Status 200, `proposal-embed` class, `iframe` tag |
| `GET /proposals/{slug}` 404 for missing, rejects traversal | 1412 | 404 with back link, 400 for malformed URI |
| Home page shows proposal cards with "View all" link | 1426 | Card title, "Recent Proposals" heading, "View all proposals" link |
| Home page has no proposal section when empty | 1443 | "Recent Proposals" and "View all proposals" absent |

### Related tests — Nav and metadata

| Test | Line | What it verifies |
|------|------|-----------------|
| Nav shows Proposals link | 932 | Dashboard nav includes "Proposals" |
| `readProposalMeta` reads/validates JSON | 1057-1097 | Happy path, missing, corrupted, path traversal |
| `proposalGradient` deterministic | 1193-1205 | Same slug = same gradient, different slugs = different gradients |

---

## Implementation Tasks

Since all acceptance criteria and tests are already implemented, there are **no code changes required**.

### Task 1: Verify existing tests pass

- [ ] **Step 1: Run the server test suite to confirm all proposal gallery tests pass**

```bash
node tests/server.test.js
```

Expected: All tests pass, including the 13 gallery-related tests documented above.

- [ ] **Step 2: Commit plan**

```
docs: add plan for PM-028 - Proposal Gallery Page
```

---

## Verification Checklist

| AC | Status | Evidence |
|----|--------|----------|
| 1. `/proposals` route in `routeDashboard()` | Already done | `server.js:1030-1031` |
| 2. `handleProposalsPage()` scans `*.meta.json` | Already done | `server.js:1693-1694` via `buildProposalCards()` at line 1378 |
| 3. Cards use `.card-grid`/`.card` CSS with proposal additions | Already done | CSS at lines 429-438 (base), 728-739 (proposal-specific) |
| 4. Sorted by date, newest first | Already done | `server.js:1424` |
| 5. Draft proposals: dashed border + phase badge, not clickable | Already done | `server.js:1415-1422`, CSS at lines 732-734 |
| 6. Completed data from meta.json, draft data from groom state | Already done | `server.js:1383-1406` (completed), `1410-1422` (draft) |
| 7. Empty state with `/pm:groom` hint | Already done | `server.js:1696-1701` |
| 8. Completed card links to `/proposals/{slug}` | Already done | `server.js:1400` |
| 9. Home page shows 6 most recent proposals | Already done | `server.js:1608` with limit 6 |
| 10. "N issues" count on cards | Already done | `server.js:1394-1396` |
| 11. Graceful handling when proposals dir missing | Already done | `server.js:1381` `fs.existsSync()` check |
