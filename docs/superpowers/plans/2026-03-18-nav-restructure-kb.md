# Nav Restructure — Knowledge Base Umbrella Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard nav changes from `Home | Research | Strategy | Backlog` to `Home | Proposals | Backlog | Knowledge Base`. Research, Competitors, and Strategy become sub-tabs within a Knowledge Base page at `/kb`. All existing URLs continue to resolve via HTTP 302 redirects.

**Architecture:** The `/kb` route renders a Knowledge Base page with server-side tab activation via `?tab=research|competitors|strategy` (default: research). Old routes (`/research`, `/strategy`, `/competitors`, `/landscape`) redirect with 302. Detail pages (`/competitors/{slug}`, `/research/{slug}`) continue to work directly. The `activeNav` parameter is set to `'/kb'` for all KB-related pages so the nav bar highlights correctly.

**Tech Stack:** Node.js (server.js), node:test

**Current state:** All 7 acceptance criteria are already implemented in the codebase. This plan documents what exists and covers remaining test gaps.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | No changes needed | All nav, routing, redirects, and KB page logic already in place |
| `tests/server.test.js` | Modify | Add tests for redirect coverage, KB tab rendering, and nav highlighting |

---

## Pre-existing Implementation Inventory

The following AC items are **already implemented** in the current codebase and require no code changes:

### AC 1 — `navLinks` array updated
**Status: Done** — `dashboardPage()` at `server.js:780-785` already defines:
```javascript
const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/kb', label: 'Knowledge Base' },
];
```

### AC 2 — `/kb` route with sub-tabs
**Status: Done** — Route handler at `server.js:988` dispatches to `handleKnowledgeBasePage()` (line 2556), which validates the `tab` query param against `['research', 'competitors', 'strategy']` and defaults to `'research'`. Sub-tabs are rendered by `buildKbSubTabs()` (line 1713) as `<a>` links with `class="kb-tab"` and active state.

### AC 3 — Sub-tabs render same content as old pages
**Status: Done** — `handleKnowledgeBasePage()` builds content inline for each tab:
- **Research** (line 2564-2605): reads `landscape.md` and `research/` topics — same logic as old `handleResearchPage()`.
- **Strategy** (line 2606-2618): reads `strategy.md` — same logic as old `handleStrategyPage()`.
- **Competitors** (line 2619-2639): reads `competitors/` directory profiles — same logic as old standalone competitors page.

### AC 4 — Server-side tab activation via query parameter
**Status: Done** — URL parsing at `server.js:981-983` extracts `tab` from query params. `/kb?tab=research`, `/kb?tab=competitors`, `/kb?tab=strategy` each activate the correct sub-tab. Default (no param) is Research.

### AC 4a — Existing URLs redirect via 302
**Status: Done** — Redirects at `server.js:990-1001`:
- `/research` → `302 /kb?tab=research`
- `/landscape` → `302 /kb?tab=research`
- `/competitors` → `302 /kb?tab=competitors`
- `/strategy` → `302 /kb?tab=strategy`

### AC 5 — Competitor detail pages continue to work
**Status: Done** — Route at `server.js:1002-1008` handles `/competitors/{slug}` → `handleCompetitorDetail()` (line 2648). Breadcrumb links back to `/kb?tab=competitors`. Nav highlighted as `/kb`.

### AC 6 — Research topic pages continue to work
**Status: Done** — Route at `server.js:1009-1015` handles `/research/{slug}` → `handleResearchTopic()` (line 2704). Breadcrumb links back to `/kb?tab=research`. Nav highlighted as `/kb`.

### AC 7 — Active nav highlighting
**Status: Done** — All KB-related handlers pass `'/kb'` as the `activeNav` parameter to `dashboardPage()`:
- `/kb` and sub-tabs: `dashboardPage(title, '/kb', body)` at line 2643
- `/competitors/{slug}`: `dashboardPage(name, '/kb', body)` at line 2699
- `/research/{slug}`: `dashboardPage(meta.label, '/kb', ...)` at line 2717
- Proposals: all use `'/proposals'` (lines 1664, 1671, 1688, 1708)
- Backlog: all use `'/backlog'` (lines 2732, 2763, 2854, 2898, 2906)
- Home: uses `'/'` (line 1633)

### KB sub-tab CSS
**Status: Done** — `.kb-tabs` and `.kb-tab` styles at `server.js:720-726` provide tab bar styling with active state highlighting matching the accent color.

---

## Remaining Gap: Test Coverage

Existing tests cover:
- `/landscape` redirect → `/kb?tab=research` (test at line 220)
- `/competitors` redirect → `/kb?tab=competitors` (test at line 243)
- `/kb?tab=research` returns topic list HTML (test at line 384)
- `/competitors/{slug}` returns tabbed detail HTML (test at line 267)
- `/research/{slug}` shows research topic detail (test at line 409)

Missing test coverage:
1. `/research` redirect → `/kb?tab=research`
2. `/strategy` redirect → `/kb?tab=strategy`
3. `/kb` (no tab param) defaults to research content
4. `/kb?tab=competitors` renders competitor cards
5. `/kb?tab=strategy` renders strategy content
6. Nav highlighting: KB nav item active on `/research/{slug}` and `/competitors/{slug}`

---

## Task 1: Add redirect and KB tab rendering tests

**Files:**
- Test: `tests/server.test.js`

- [ ] **Step 1: Add test for `/research` redirect**

```javascript
test('GET /research redirects to /kb?tab=research', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Landscape\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, '/research');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=research');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Add test for `/strategy` redirect**

```javascript
test('GET /strategy redirects to /kb?tab=strategy', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, headers } = await httpGet(port, '/strategy');
      assert.equal(statusCode, 302);
      assert.equal(headers.location, '/kb?tab=strategy');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 3: Add test for `/kb` default tab**

```javascript
test('GET /kb with no tab param defaults to research content', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/landscape.md': '---\ntype: landscape\n---\n# Market Landscape\n',
    'pm/research/pricing/findings.md': '---\ntopic: Pricing\nupdated: 2026-03-12\n---\n# Pricing Research\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Research'), 'must show Research heading');
      assert.ok(body.includes('kb-tab active') || body.includes('class="kb-tab active"'), 'research tab must be active');
      assert.ok(body.includes('Pricing'), 'must show research topic');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 4: Add test for `/kb?tab=competitors`**

```javascript
test('GET /kb?tab=competitors renders competitor cards', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=competitors');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Competitors'), 'must show Competitors heading');
      assert.ok(body.includes('Acme Corp'), 'must show competitor name');
      assert.ok(body.includes('/competitors/acme'), 'must link to competitor detail');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 5: Add test for `/kb?tab=strategy`**

```javascript
test('GET /kb?tab=strategy renders strategy content', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Product Strategy\n\nOur north star is quality.\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/kb?tab=strategy');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Strategy'), 'must show Strategy heading');
      assert.ok(body.includes('north star'), 'must render strategy markdown content');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 6: Add test for nav highlighting on detail pages**

```javascript
test('Competitor detail page highlights Knowledge Base nav item', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/competitors/acme/profile.md': '---\ntype: competitor\nname: Acme Corp\n---\n# Acme Corp\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/competitors/acme');
      // The nav link for /kb should have class="active"
      assert.ok(body.includes('href="/kb" class="active"'), 'KB nav item must be highlighted on competitor detail');
      assert.ok(!body.includes('href="/" class="active"'), 'Home must not be highlighted');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Research topic page highlights Knowledge Base nav item', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/research/pricing/findings.md': '---\ntopic: Pricing\nupdated: 2026-03-12\n---\n# Pricing Research\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/research/pricing');
      assert.ok(body.includes('href="/kb" class="active"'), 'KB nav item must be highlighted on research topic');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 7: Run tests — verify all pass**

```bash
node tests/server.test.js
```

All tests should pass immediately since they cover existing, already-implemented behavior.

- [ ] **Step 8: Commit**

```
test(PM-029): add redirect, KB tab rendering, and nav highlighting tests
```

---

## Verification Checklist

| AC | Status | Evidence |
|----|--------|----------|
| 1. `navLinks` updated to Home, Proposals, Backlog, KB | Already done | `server.js:780-785` |
| 2. `/kb` route with Research/Competitors/Strategy sub-tabs | Already done | `server.js:988` → `handleKnowledgeBasePage()` at line 2556 |
| 3. Sub-tabs render same content as old pages | Already done | KB handler reuses same content logic |
| 4. Server-side tab activation via `?tab=` query param, default=Research | Already done | `server.js:983,2558` |
| 4a. Old URLs redirect with 302 | Already done | `server.js:990-1001` |
| 5. Competitor detail pages work | Already done | `server.js:1002-1008` → `handleCompetitorDetail()` |
| 6. Research topic pages work | Already done | `server.js:1009-1015` → `handleResearchTopic()` |
| 7. Active nav highlighting correct for all routes | Already done | All handlers pass correct `activeNav` to `dashboardPage()` |
