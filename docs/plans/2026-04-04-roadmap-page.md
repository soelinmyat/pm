# PM-123: Roadmap Page (rename Backlog) -- Implementation Plan

## Header

**Goal:** Rename "Backlog" to "Roadmap" across all routes, nav, breadcrumbs, and hrefs. Redesign as a clean 3-column kanban (Groomed / In Progress / Shipped) with column counts, filter input, and dimmed shipped column. Remove stat cards and proposals-view toggle.

**Architecture:** Single-file server at `pm_plugin/scripts/server.js` (~5,656 lines). All changes in this one file plus tests.

**Files modified:**
- `pm_plugin/scripts/server.js` (routes, handlers, nav, hrefs)
- `pm_plugin/tests/server.test.js` (route and content assertions)

**Done when:**
1. `/roadmap` renders the 3-column kanban with Groomed/In Progress/Shipped headers and counts
2. `/backlog` 302-redirects to `/roadmap`; `/backlog/shipped` redirects to `/roadmap/shipped`; `/backlog/archived` redirects to `/roadmap/archived`; `/backlog/wireframes/*` redirects to `/roadmap/wireframes/*`; `/backlog/:slug` redirects to `/roadmap/:slug`
3. Nav sidebar reads "Roadmap" (not "Backlog"), links to `/roadmap`
4. All ~30 internal `href="/backlog/..."` references updated to `/roadmap/...`
5. Breadcrumbs read "Roadmap" everywhere
6. Shipped column has `opacity: 0.7`, shows top 10, "View all N shipped" link
7. Filter input above kanban filters cards client-side
8. `buildBacklogGrouped()` removed (dead code)
9. All existing tests pass; new tests cover redirect, nav label, column headers

**Verification:** `cd pm_plugin && node --test`

---

## Upstream Context (from PM-117 research)

- Linear uses "Roadmap" language for forward-looking boards, never "Backlog"
- 3-column kanban: column IS the status, no redundant status badges on cards
- Shipped column dimmed at 0.7 opacity, hover restores to 1.0
- Column headers: uppercase 12px, count badge right-aligned
- Filter input: full-width, `--surface` bg, `--border` border, `--accent` on focus

---

## Task Breakdown

### Task 1: TDD -- Write redirect and nav tests (lines N/A in test file)

**Red:** Add tests asserting:
- `GET /backlog` returns 302 with `Location: /roadmap`
- `GET /backlog/shipped` returns 302 with `Location: /roadmap/shipped`
- `GET /backlog/archived` returns 302 with `Location: /roadmap/archived`
- `GET /roadmap` returns 200 with `<h1>Roadmap</h1>`
- Response HTML contains nav item `Roadmap` (not `Backlog`)
- Response HTML contains column headers `Groomed`, `In Progress`, `Shipped`

**Green:** Implement in subsequent tasks.

### Task 2: Rename nav in `dashboardPage()` (line 1226)

**File:** `server.js`
**Line range:** 1222-1227

**Current:**
```js
const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/kb?tab=research', label: 'Knowledge Base' },
  { href: '/backlog', label: 'Backlog' },
];
```

**New:**
```js
const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/kb?tab=research', label: 'Knowledge Base' },
  { href: '/roadmap', label: 'Roadmap' },
];
```

### Task 3: Update `routeDashboard()` routes (lines 1742-1768)

**File:** `server.js`
**Line range:** 1742-1768 (the `/backlog` route block)

Replace the existing `/backlog` routes with `/roadmap` routes, and add `/backlog` -> `/roadmap` redirects.

**New route block:**
```js
} else if (urlPath === '/roadmap') {
  handleBacklog(res, pmDir, view);
} else if (urlPath === '/roadmap/shipped') {
  handleShipped(res, pmDir);
} else if (urlPath === '/roadmap/archived') {
  handleArchived(res, pmDir);
} else if (urlPath.match(/^\/roadmap\/wireframes\/.+\/raw$/)) {
  const slug = decodeURIComponent(urlPath.slice('/roadmap/wireframes/'.length)).replace(/\/raw$/, '').replace(/\.html$/, '');
  const wfDir = path.resolve(pmDir, 'backlog', 'wireframes');
  const wfPath = path.resolve(wfDir, slug + '.html');
  if (wfPath.startsWith(wfDir + path.sep) && fs.existsSync(wfPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(wfPath, 'utf-8'));
  } else {
    res.writeHead(404); res.end('Not found');
  }
} else if (urlPath.startsWith('/roadmap/wireframes/')) {
  const slug = decodeURIComponent(urlPath.slice('/roadmap/wireframes/'.length)).replace(/\/$/, '').replace(/\.html$/, '');
  handleWireframe(res, pmDir, slug);
} else if (urlPath.startsWith('/roadmap/')) {
  const slug = urlPath.slice('/roadmap/'.length).replace(/\/$/, '');
  if (slug && !slug.includes('/') && !slug.includes('..')) {
    handleBacklogItem(res, pmDir, slug);
  } else {
    res.writeHead(404); res.end('Not found');
  }
// Legacy /backlog redirects
} else if (urlPath === '/backlog') {
  res.writeHead(302, { 'Location': '/roadmap' }); res.end();
} else if (urlPath === '/backlog/shipped') {
  res.writeHead(302, { 'Location': '/roadmap/shipped' }); res.end();
} else if (urlPath === '/backlog/archived') {
  res.writeHead(302, { 'Location': '/roadmap/archived' }); res.end();
} else if (urlPath.startsWith('/backlog/wireframes/')) {
  const rest = urlPath.slice('/backlog/wireframes'.length);
  res.writeHead(302, { 'Location': '/roadmap/wireframes' + rest }); res.end();
} else if (urlPath.startsWith('/backlog/')) {
  const rest = urlPath.slice('/backlog'.length);
  res.writeHead(302, { 'Location': '/roadmap' + rest }); res.end();
```

### Task 4: Update `handleBacklog()` page title and subtitle (lines 5104-5108)

**File:** `server.js`
**Line range:** 5104-5108

**Current:**
```js
const body = `<div class="page-header"><h1>Backlog</h1></div>
${searchHtml}
${contentHtml}`;

const html = dashboardPage('Backlog', '/backlog', body);
```

**New:**
```js
const body = `<div class="page-header"><h1>Roadmap</h1>
  <p class="subtitle">What's coming, what's in progress, and what just shipped</p>
</div>
${searchHtml}
${contentHtml}`;

const html = dashboardPage('Roadmap', '/roadmap', body);
```

### Task 5: Update `buildBacklogKanban()` column labels (lines 3223-3226)

**File:** `server.js`
**Line range:** 3223-3226

**Current:**
```js
const columns = [
  { key: 'open', label: 'Open', items: openItems },
  { key: 'in-progress', label: 'In Progress', items: inProgressItems },
  { key: 'done', label: 'Shipped', items: doneItems.slice(0, 10), total: doneItems.length },
];
```

**New:**
```js
const columns = [
  { key: 'open', label: 'Groomed', items: openItems },
  { key: 'in-progress', label: 'In Progress', items: inProgressItems },
  { key: 'done', label: 'Shipped', items: doneItems.slice(0, 10), total: doneItems.length },
];
```

Also update the kanban-col rendering (line 3249) to add the `shipped` class for the done column:
```js
return `<div class="kanban-col${column.key === 'done' ? ' shipped' : ''}${column.items.length === 0 ? ' col-empty' : ''}">
```

And remove the per-card status badges (lines 3232-3234) since column IS the status. Replace:
```js
const badgeHtml = column.key === 'done'
  ? '<span class="status-badge badge-done">shipped</span>'
  : `<span class="status-badge badge-${escHtml(item.status)}">${escHtml(item.status)}</span>`;
```
With:
```js
const badgeHtml = '';
```

### Task 6: Global href replacement -- `/backlog/` to `/roadmap/` (30+ occurrences)

**File:** `server.js`

Find-and-replace all remaining `href="/backlog/` with `href="/roadmap/` and all `href="/backlog"` with `href="/roadmap"` across these handler functions:
- `buildBacklogKanban` (lines 3150, 3160, 3238, 3245)
- `handleShipped` (lines 5152, 5160)
- `handleArchived` (lines 5204, 5212)
- `handleBacklogItem` (lines 5224, 5252, 5262, 5274, 5290)
- `handleDashboardHome` (lines 3458, 3570)
- `handleProposalsPage` (line 3967)
- `handleSessionPage` / wireframe links (lines 2622, 3796, 3830)
- `handleWireframe` (lines 4987, 5076)
- `dashboardPage` activeNav checks (where `/backlog` is passed -- lines 5108, 5164, 5216)

Also update breadcrumbs from `"&larr; Backlog"` to `"&larr; Roadmap"` in:
- `handleShipped` (line 5160)
- `handleArchived` (line 5212)
- `handleBacklogItem` (line 5290)

### Task 7: Add CSS for shipped column dimming

**File:** `server.js` (in DASHBOARD_CSS string)

Add to the kanban section of DASHBOARD_CSS:
```css
.kanban-col.shipped .kanban-item { opacity: 0.7; }
.kanban-col.shipped .kanban-item:hover { opacity: 1; }
```

### Task 8: Remove `buildBacklogGrouped()` dead code (lines 3021-3168)

**File:** `server.js`
**Line range:** 3021-3168

Delete the entire `buildBacklogGrouped()` function. Verify no callers reference it (grep confirms it's unused after the kanban-only refactor).

### Task 9: Update filter placeholder text (line 5086)

**Current:** `placeholder="Filter backlog..."`
**New:** `placeholder="Filter issues..."`

### Task 10: Run tests and fix regressions

```bash
cd pm_plugin && node --test
```

Fix any assertion failures from old route expectations or content checks.
