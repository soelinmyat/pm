# Backlog Grouped by Proposal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backlog page defaults to a proposal-grouped view with collapsible proposal headers, gradient swatches, status badges on individual items, parent chain walk, view toggle, and a standalone issues section at the bottom.

**Architecture:** `buildBacklogGrouped(pmDir)` scans backlog items, walks parent chains via `findProposalAncestor()` to find proposal ancestors, groups items under proposals, and renders grouped HTML. `handleBacklog(res, pmDir, view)` switches between grouped (default) and kanban views based on `?view=` query param. `readProposalMeta()` supplies gradient + title for group headers. `sanitizeGradient()` validates gradient values. `escHtml()` + `encodeURIComponent()` handle XSS safety.

**Tech Stack:** Node.js (server.js), node:test

**Current state:** The vast majority of PM-030 is already implemented. The earlier plan (`2026-03-17-backlog-grouped.md`) was fully executed. This plan documents what exists, identifies one remaining gap, and covers the fix.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | Modify (minor) | Gap: individual items in grouped view lack status badges (AC 4) |
| `tests/server.test.js` | Modify | Add test for status badge presence in grouped view |

---

## Pre-existing Implementation Inventory

The following AC items are **already implemented** in the current codebase and require no code changes:

### AC 1 — Backlog page default view is "By Proposal"
**Status: Done** — `handleBacklog()` at `server.js:2752` defaults to the grouped view. When `view !== 'kanban'`, it calls `buildBacklogGrouped(pmDir)` and renders the proposal-grouped HTML. The URL `/backlog` (no query param) renders the grouped view.

### AC 2 — Grouping rule with parent chain walk
**Status: Done** — `findProposalAncestor()` at `server.js:1359` walks the parent chain up to depth 10 with cycle detection via `visited` set. Proposal slugs are built from `pm/backlog/proposals/{slug}.meta.json` files at `server.js:1232-1238`. Items with no proposal ancestor go to standalone. Dead proposal chains (parent points to non-existent slug) get their own group. All tested at `server.test.js:1522-1551`.

### AC 3 — Proposal group header: gradient swatch, title, issue count with status breakdown
**Status: Done** — `buildBacklogGrouped()` at `server.js:1311-1320` renders a `<a class="group-header">` with:
- `.group-gradient` div with `background: ${gradient}` via `sanitizeGradient()` (server.js:1373)
- `.group-title` from `readProposalMeta()` title or `humanizeSlug()` fallback
- `.group-count` with status breakdown: "3 issues — 2 idea, 1 drafted" (server.js:1283-1289)

Tested at `server.test.js:1553-1569`.

### AC 5 — Standalone Issues section at bottom
**Status: Done** — `buildBacklogGrouped()` at `server.js:1341-1354` renders standalone items (no proposal ancestor) in a `<div class="proposal-group">` with `.standalone-header` class, gray background, and "Standalone Issues" title with item count. Tested at `server.test.js:1566-1567`.

### AC 6 — Dead proposal: slug as plain text, no gradient, no link
**Status: Done** — When `readProposalMeta()` returns null (no `.meta.json` for the slug), the group renders with a `<div>` instead of `<a>`, no `.group-gradient` div, and `humanizeSlug(proposalSlug)` as the title (server.js:1321-1329). Tested at `server.test.js:1581-1591`.

### AC 7 — View toggle ("By Proposal" | "Kanban")
**Status: Done** — `handleBacklog()` at `server.js:2754-2757` renders a `.view-toggle` div with two `.toggle-btn` links. The active view gets the `.active` class. CSS at `server.js:742-748`. Tested at `server.test.js:1628-1648`.

### AC 8 — Toggle state persists via URL query parameter
**Status: Done** — Route at `server.js:984` extracts `view` from `urlObj.searchParams.get('view')`. Links use `?view=proposals` and `?view=kanban`. Default (no param) = proposals. Tested at `server.test.js:1594-1648`.

### AC 9 — Flat kanban view renders identically to current implementation
**Status: Done** — When `view === 'kanban'`, `handleBacklog()` falls through to the existing kanban code (server.js:2769-2856) with the toggle prepended. No kanban rendering logic was modified. Tested at `server.test.js:1612-1625` and existing kanban tests at `server.test.js:299-347`.

### AC 10 — Proposal group headers link to `/proposals/{slug}`
**Status: Done** — Group header is an `<a href="/proposals/${escHtml(encodeURIComponent(proposalSlug))}">` (server.js:1315). Dead proposals use `<div>` instead (no link). Tested implicitly via `server.test.js:1553-1569` (group-header present in output).

---

## Remaining Gap

### AC 4 — Issues within a group show: PM-ID, title, **status badge**
**Status: Partial** — Individual items in grouped view show PM-ID and title (server.js:1332-1335) and children are indented via `.child-item` class with `margin-left: 1.25rem` (CSS at server.js:760). However, **status badges are missing** from individual items. The kanban view renders status badges (`badge-in-progress`, `badge-approved`) but `buildBacklogGrouped()` does not include them.

---

## Task 1: Add status badges to grouped view items

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing test for status badge in grouped view**

Add to `tests/server.test.js` after the existing `buildBacklogGrouped` tests:

```javascript
test('buildBacklogGrouped shows status badges on individual items', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-z.meta.json': JSON.stringify({
      title: 'Feature Z', date: '2026-03-18',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      verdictLabel: 'Ready', issueCount: 3
    }),
    'pm/backlog/feat-z.md': '---\ntitle: "Feature Z"\nstatus: drafted\nparent: null\nid: "PM-040"\n---\n',
    'pm/backlog/task-a.md': '---\ntitle: "Task A"\nstatus: in-progress\nparent: "feat-z"\nid: "PM-041"\n---\n',
    'pm/backlog/task-b.md': '---\ntitle: "Task B"\nstatus: idea\nparent: "feat-z"\nid: "PM-042"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    // Each item should have a status badge
    assert.ok(html.includes('status-badge'), 'must show status badges on items');
    // Specifically, in-progress should get a badge
    assert.ok(html.includes('badge-in-progress'), 'must show in-progress badge');
    // Drafted items should get a badge
    assert.ok(html.includes('badge-drafted'), 'must show drafted badge');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests — verify fail**

```bash
node tests/server.test.js
```

Expected: new test fails because `buildBacklogGrouped` does not emit `status-badge` spans.

- [ ] **Step 3: Add status badge rendering to buildBacklogGrouped**

In `scripts/server.js`, modify the item rendering loop inside `buildBacklogGrouped()` (around line 1332-1335).

Change:
```javascript
for (const { item, isChild } of ordered) {
  const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
  const childClass = isChild ? ' child-item' : '';
  html += `<a class="kanban-item priority-${safePriority(item.priority)}${childClass}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">${idHtml}<span class="kanban-item-title">${escHtml(item.title)}</span></a>\n`;
}
```

To:
```javascript
for (const { item, isChild } of ordered) {
  const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
  const badgeHtml = item.status ? `<span class="status-badge badge-${escHtml(item.status)}">${escHtml(item.status)}</span>` : '';
  const childClass = isChild ? ' child-item' : '';
  html += `<a class="kanban-item priority-${safePriority(item.priority)}${childClass}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">${idHtml}${badgeHtml}<span class="kanban-item-title">${escHtml(item.title)}</span></a>\n`;
}
```

Apply the same change to the standalone items loop (around line 1349-1351):

Change:
```javascript
for (const item of standalone) {
  const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
  html += `<a class="kanban-item priority-${safePriority(item.priority)}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">${idHtml}<span class="kanban-item-title">${escHtml(item.title)}</span></a>\n`;
}
```

To:
```javascript
for (const item of standalone) {
  const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
  const badgeHtml = item.status ? `<span class="status-badge badge-${escHtml(item.status)}">${escHtml(item.status)}</span>` : '';
  html += `<a class="kanban-item priority-${safePriority(item.priority)}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">${idHtml}${badgeHtml}<span class="kanban-item-title">${escHtml(item.title)}</span></a>\n`;
}
```

The existing `.status-badge` CSS (server.js:450) already provides the base styling. The badge classes `badge-in-progress` and `badge-approved` are already defined (server.js:451-452). Other statuses (`idea`, `drafted`, `done`) will get the base `.status-badge` styling which is sufficient.

- [ ] **Step 4: Run full test suite — verify all pass**

```bash
node tests/server.test.js
```

Expected: all tests pass including the new status badge test. Existing tests should not regress — the added badge HTML does not conflict with any existing assertions.

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: add status badges to backlog grouped view items (PM-030 AC 4)"
```

---

## Test Coverage Summary

| Test | AC | Location |
|------|-----|----------|
| `findProposalAncestor walks parent chain to find proposal` | AC 2 | server.test.js:1522 |
| `findProposalAncestor returns null for standalone items` | AC 2, 5 | server.test.js:1535 |
| `findProposalAncestor handles circular chains safely` | AC 2 | server.test.js:1546 |
| `buildBacklogGrouped groups items under proposals` | AC 1, 3, 4, 5, 10 | server.test.js:1553 |
| `buildBacklogGrouped returns empty state for empty backlog` | AC 1 | server.test.js:1572 |
| `buildBacklogGrouped shows dead proposal as plain text` | AC 6 | server.test.js:1581 |
| `buildBacklogGrouped shows status badges on individual items` | AC 4 | **NEW** |
| `GET /backlog defaults to proposal-grouped view` | AC 1, 7 | server.test.js:1594 |
| `GET /backlog?view=kanban renders existing kanban` | AC 7, 8, 9 | server.test.js:1612 |
| `GET /backlog toggle highlights active view correctly` | AC 7, 8 | server.test.js:1628 |
