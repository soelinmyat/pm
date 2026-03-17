# Backlog Grouped by Proposal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proposal-grouped default view to the backlog page with parent chain walk, view toggle, and standalone issues section.

**Architecture:** `buildBacklogGrouped(pmDir)` scans backlog items, walks parent chains to find proposal ancestors, groups items under proposals, and renders grouped HTML. `handleBacklog(res, pmDir, view)` switches between grouped (default) and kanban views based on `?view=` query param.

**Tech Stack:** Node.js (server.js), node:test

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | Modify | Add CSS, `findProposalAncestor()`, `buildBacklogGrouped()`, modify `handleBacklog()` + route, update exports |
| `tests/server.test.js` | Modify | Add 8 new tests |

---

## Task 1: CSS + findProposalAncestor helper

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing test for findProposalAncestor**

```javascript
test('findProposalAncestor walks parent chain to find proposal', () => {
  const mod = loadServer();
  // items: child -> parent -> proposal-slug
  const items = {
    'child': { parent: 'parent-issue' },
    'parent-issue': { parent: 'my-proposal' },
    'my-proposal': { parent: null },
  };
  const proposals = new Set(['my-proposal']);
  assert.equal(mod.findProposalAncestor('child', items, proposals), 'my-proposal');
  assert.equal(mod.findProposalAncestor('parent-issue', items, proposals), 'my-proposal');
  assert.equal(mod.findProposalAncestor('my-proposal', items, proposals), 'my-proposal');
});

test('findProposalAncestor returns null for standalone items', () => {
  const mod = loadServer();
  const items = {
    'orphan': { parent: null },
    'child-of-orphan': { parent: 'orphan' },
  };
  const proposals = new Set(['some-proposal']);
  assert.equal(mod.findProposalAncestor('orphan', items, proposals), null);
  assert.equal(mod.findProposalAncestor('child-of-orphan', items, proposals), null);
});

test('findProposalAncestor handles circular chains safely', () => {
  const mod = loadServer();
  const items = {
    'a': { parent: 'b' },
    'b': { parent: 'a' },
  };
  const proposals = new Set();
  // Should not infinite loop — returns null after depth limit
  assert.equal(mod.findProposalAncestor('a', items, proposals), null);
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Implement findProposalAncestor and add CSS**

```javascript
function findProposalAncestor(slug, items, proposalSlugs) {
  let current = slug;
  const visited = new Set();
  for (let depth = 0; depth < 10; depth++) {
    if (proposalSlugs.has(current)) return current;
    if (visited.has(current)) return null;
    visited.add(current);
    const item = items[current];
    if (!item || !item.parent) return null;
    current = item.parent;
  }
  return null;
}
```

CSS (add before `/* Animations */`):
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
.standalone-header { background: #f0f0f0; cursor: default; }
.standalone-header:hover { background: #f0f0f0; }
```

Export `findProposalAncestor`.

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

## Task 2: buildBacklogGrouped helper

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing test**

```javascript
test('buildBacklogGrouped groups items under proposals', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-x.meta.json': JSON.stringify({ title: 'Feature X', date: '2026-03-17', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', verdictLabel: 'Ready', issueCount: 2 }),
    'pm/backlog/feat-x.md': '---\ntitle: "Feature X"\nstatus: drafted\nparent: null\nid: "PM-001"\n---\n',
    'pm/backlog/child-a.md': '---\ntitle: "Child A"\nstatus: idea\nparent: "feat-x"\nid: "PM-002"\n---\n',
    'pm/backlog/standalone.md': '---\ntitle: "Standalone"\nstatus: idea\nid: "PM-003"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('Feature X'), 'must show proposal group header');
    assert.ok(html.includes('group-gradient'), 'must show gradient swatch');
    assert.ok(html.includes('Child A'), 'must show child item');
    assert.ok(html.includes('Standalone'), 'must show standalone section');
    assert.ok(html.includes('standalone-header'), 'standalone must have distinct header');
    // Proposal group should come before standalone
    assert.ok(html.indexOf('Feature X') < html.indexOf('Standalone Issues'), 'proposals before standalone');
  } finally { cleanup(); }
});

test('buildBacklogGrouped returns empty state for empty backlog', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('empty-state') || html.includes('No backlog'), 'must show empty state');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Implement buildBacklogGrouped**

The function scans backlog, builds parent map, walks chains, groups items, renders HTML. Key points:
- Uses `readProposalMeta()` for gradient + title
- Uses `sanitizeGradient()` for style attribute
- Uses `escHtml()` for all user content
- Uses `encodeURIComponent()` for slug in links
- Renders items within each group: parents first, children indented after their parent
- Status breakdown: count items per status in each group

Export `buildBacklogGrouped`.

- [ ] **Step 4: Run tests — verify pass**
- [ ] **Step 5: Commit**

## Task 3: Modify handleBacklog + route for view toggle

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
test('GET /backlog defaults to proposal-grouped view', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-y.meta.json': JSON.stringify({ title: 'Feature Y', date: '2026-03-17', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', verdictLabel: 'Ready', issueCount: 1 }),
    'pm/backlog/feat-y.md': '---\ntitle: "Feature Y"\nstatus: drafted\nparent: null\nid: "PM-010"\n---\n',
    'pm/backlog/task-1.md': '---\ntitle: "Task 1"\nstatus: idea\nparent: "feat-y"\nid: "PM-011"\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('view-toggle'), 'must show view toggle');
      assert.ok(body.includes('proposal-group'), 'must show proposal groups');
      assert.ok(body.includes('Feature Y'), 'must show proposal header');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /backlog?view=kanban renders existing kanban', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/item-1.md': '---\ntitle: "Item 1"\nstatus: idea\nid: "PM-020"\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/backlog?view=kanban');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('view-toggle'), 'must show view toggle');
      assert.ok(body.includes('kanban'), 'must render kanban columns');
      assert.ok(body.includes('Item 1'), 'must show item');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /backlog toggle highlights active view', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/item.md': '---\ntitle: "Item"\nstatus: idea\nid: "PM-030"\n---\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const def = await httpGet(port, '/backlog');
      assert.ok(def.body.includes('view=proposals" class="toggle-btn active"') || def.body.includes("view=proposals\" class=\"toggle-btn active\""), 'proposals must be active by default');

      const kanban = await httpGet(port, '/backlog?view=kanban');
      assert.ok(kanban.body.includes('view=kanban" class="toggle-btn active"') || kanban.body.includes("view=kanban\" class=\"toggle-btn active\""), 'kanban must be active when selected');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Modify handleBacklog and route**

Change `handleBacklog(res, pmDir)` signature to `handleBacklog(res, pmDir, view)`.

In routing, pass the view param:
```javascript
} else if (urlPath === '/backlog') {
  handleBacklog(res, pmDir, tab);  // tab = urlObj.searchParams.get('tab') — wait, need 'view' not 'tab'
```

Actually, the routing already has `urlObj.searchParams` from the KB work. Add:
```javascript
const view = urlObj.searchParams.get('view');
```
And pass `view` to `handleBacklog`.

Inside `handleBacklog`, add toggle bar rendering and view switching:
```javascript
const isKanban = view === 'kanban';
const toggleHtml = `<div class="view-toggle">
  <a href="/backlog?view=proposals" class="toggle-btn${!isKanban ? ' active' : ''}">By Proposal</a>
  <a href="/backlog?view=kanban" class="toggle-btn${isKanban ? ' active' : ''}">Kanban</a>
</div>`;

if (!isKanban) {
  // Proposal-grouped view
  const groupedHtml = buildBacklogGrouped(pmDir);
  const body = `<div class="page-header"><h1>Backlog</h1></div>${toggleHtml}${groupedHtml}`;
  // ... render
} else {
  // Existing kanban (unchanged, but with toggle prepended)
  // ... existing kanban code with toggleHtml added to body
}
```

- [ ] **Step 4: Run full test suite — verify all pass**
- [ ] **Step 5: Commit**
