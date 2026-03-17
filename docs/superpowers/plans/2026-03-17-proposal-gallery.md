# Proposal Gallery Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proposal gallery page and home page proposal section to the PM dashboard, making groom proposals the hero artifact.

**Architecture:** Shared `buildProposalCards(pmDir, limit)` helper scans `*.meta.json` files + groom state, renders card HTML. New `handleProposalsPage` route renders the full gallery. `handleProposalDetail` serves raw proposal HTML files. `handleDashboardHome` modified to inject a proposals section above KB stats.

**Tech Stack:** Node.js (server.js), node:test, CSS-in-JS string template

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | Modify | Add CSS, `sanitizeGradient()`, `buildProposalCards()`, `handleProposalsPage()`, `handleProposalDetail()`, modify `handleDashboardHome()`, add routes, update exports |
| `tests/server.test.js` | Modify | Add 10 new tests for gallery, detail, home page, gradient sanitization |

---

## Chunk 1: CSS + sanitizeGradient + buildProposalCards

### Task 1: Add proposal card CSS and sanitizeGradient helper

**Files:**
- Modify: `scripts/server.js` (DASHBOARD_CSS at ~line 706, helpers at ~line 1067)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing test for sanitizeGradient**

```javascript
test('sanitizeGradient returns valid gradients and falls back for invalid', () => {
  const mod = loadServer();
  assert.equal(
    mod.sanitizeGradient('linear-gradient(135deg, #667eea 0%, #764ba2 100%)'),
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'valid gradient passes through'
  );
  assert.equal(mod.sanitizeGradient(null), '#e5e7eb', 'null falls back to gray');
  assert.equal(mod.sanitizeGradient(undefined), '#e5e7eb', 'undefined falls back to gray');
  assert.equal(mod.sanitizeGradient(''), '#e5e7eb', 'empty string falls back to gray');
  assert.equal(mod.sanitizeGradient('url(javascript:alert(1))'), '#e5e7eb', 'XSS attempt falls back to gray');
  assert.equal(mod.sanitizeGradient('red'), '#e5e7eb', 'plain color falls back to gray');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern 'sanitizeGradient' tests/server.test.js`
Expected: FAIL with "mod.sanitizeGradient is not a function"

- [ ] **Step 3: Implement sanitizeGradient and add CSS**

Add to `scripts/server.js` after `readGroomState()` (around line 1067):

```javascript
function sanitizeGradient(value) {
  if (typeof value === 'string' && /^linear-gradient\(/.test(value)) return value;
  return '#e5e7eb';
}
```

Add to `DASHBOARD_CSS` before `/* Animations */` comment:

```css
/* Proposal cards */
.proposal-card { position: relative; overflow: hidden; }
.proposal-card .card-gradient { height: 48px; border-radius: var(--radius) var(--radius) 0 0; }
.proposal-card h3 { margin: 0.5rem 0 0.25rem; }
.proposal-card.draft { border-style: dashed; border-color: #b8d4f0; cursor: default; opacity: 0.85; }
.proposal-card.draft:hover { box-shadow: var(--shadow-sm); transform: none; }
.draft-gradient { background: repeating-linear-gradient(45deg, #e8e8e8, #e8e8e8 10px, #f0f0f0 10px, #f0f0f0 20px); }
.badge-draft { background: #dbeafe; color: #1d4ed8; }
.proposals-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem; }
.proposals-header h2 { margin: 0; }
.proposals-view-all { font-size: 0.8125rem; color: var(--accent); text-decoration: none; }
.proposals-view-all:hover { text-decoration: underline; }
```

Add `sanitizeGradient` to exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern 'sanitizeGradient' tests/server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: add proposal card CSS and sanitizeGradient helper"
```

### Task 2: Implement buildProposalCards shared helper

**Files:**
- Modify: `scripts/server.js` (~line 1070, after sanitizeGradient)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing tests for buildProposalCards**

```javascript
test('buildProposalCards returns cards for existing proposals', () => {
  const meta1 = { title: 'Feature A', date: '2026-03-15', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 5, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const meta2 = { title: 'Feature B', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 3, gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feature-a.meta.json': JSON.stringify(meta1),
    'pm/backlog/proposals/feature-b.meta.json': JSON.stringify(meta2),
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 2);
    assert.ok(cardsHtml.includes('Feature B'), 'newer proposal must appear');
    assert.ok(cardsHtml.includes('Feature A'), 'older proposal must appear');
    // Feature B (2026-03-17) should come before Feature A (2026-03-15)
    assert.ok(cardsHtml.indexOf('Feature B') < cardsHtml.indexOf('Feature A'), 'must be sorted newest first');
  } finally { cleanup(); }
});

test('buildProposalCards includes draft card from groom state', () => {
  const meta = { title: 'Completed', date: '2026-03-10', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 2, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/completed.meta.json': JSON.stringify(meta),
    '.pm/.groom-state.md': '---\ntopic: "In Progress Feature"\nphase: research\nstarted: 2026-03-17\n---\n',
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 2);
    assert.ok(cardsHtml.includes('In Progress Feature'), 'draft card must appear');
    assert.ok(cardsHtml.includes('draft'), 'draft card must have draft class');
    assert.ok(cardsHtml.includes('/pm:groom'), 'draft card must have resume hint');
    // Draft should be pinned first
    assert.ok(cardsHtml.indexOf('In Progress Feature') < cardsHtml.indexOf('Completed'), 'draft must be pinned first');
  } finally { cleanup(); }
});

test('buildProposalCards returns empty when no proposals exist', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null);
    assert.equal(totalCount, 0);
    assert.equal(cardsHtml, '');
  } finally { cleanup(); }
});

test('buildProposalCards respects limit', () => {
  const metas = {};
  for (let i = 1; i <= 8; i++) {
    metas[`pm/backlog/proposals/feat-${i}.meta.json`] = JSON.stringify({
      title: `Feature ${i}`, date: `2026-03-${String(i).padStart(2, '0')}`, verdict: 'ready',
      verdictLabel: 'Ready', phase: 'completed', issueCount: 1,
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: []
    });
  }
  const { pmDir, cleanup } = withPmDir(metas);
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, 3);
    assert.equal(totalCount, 8, 'totalCount must be pre-limit count');
    // Only 3 cards rendered (the 3 newest: Feature 8, 7, 6)
    assert.ok(cardsHtml.includes('Feature 8'), 'newest must appear');
    assert.ok(!cardsHtml.includes('Feature 1'), 'oldest must be excluded by limit');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern 'buildProposalCards' tests/server.test.js`
Expected: FAIL with "mod.buildProposalCards is not a function"

- [ ] **Step 3: Implement buildProposalCards**

Add to `scripts/server.js` after `sanitizeGradient()`:

```javascript
function buildProposalCards(pmDir, limit) {
  const entries = [];

  // Scan completed proposals
  const proposalsDir = path.join(pmDir, 'backlog', 'proposals');
  if (fs.existsSync(proposalsDir)) {
    const files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'));
    for (const file of files) {
      const slug = file.replace('.meta.json', '');
      const meta = readProposalMeta(slug, pmDir);
      if (!meta) continue;
      const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title : humanizeSlug(slug);
      const gradient = sanitizeGradient(meta.gradient);
      const stale = stalenessInfo(meta.date);
      const staleLabel = stale ? stale.label : '';
      const verdictHtml = meta.verdictLabel
        ? `<span class="badge badge-ready">${escHtml(meta.verdictLabel)}</span> `
        : '';
      const issueHtml = typeof meta.issueCount === 'number'
        ? `<span class="badge">${meta.issueCount} issue${meta.issueCount !== 1 ? 's' : ''}</span>`
        : '';
      entries.push({
        date: meta.date || '0000-00-00',
        isDraft: false,
        html: `<a href="/proposals/${escHtml(slug)}" class="card proposal-card">
  <div class="card-gradient" style="background: ${gradient}"></div>
  <h3>${escHtml(title)}</h3>
  <p class="meta">${escHtml(staleLabel)}</p>
  <div class="card-footer"><div>${verdictHtml}${issueHtml}</div><span class="view-link">View →</span></div>
</a>`
      });
    }
  }

  // Check for draft from groom state
  const groomState = readGroomState(pmDir);
  if (groomState) {
    const topic = escHtml(groomState.topic);
    const phase = escHtml(groomPhaseLabel(groomState.phase || ''));
    const started = escHtml(groomState.started || '');
    entries.push({
      date: '9999-99-99', // pin to front
      isDraft: true,
      html: `<div class="card proposal-card draft">
  <div class="card-gradient draft-gradient"></div>
  <h3>${topic}</h3>
  <p class="meta">Grooming since ${started}</p>
  <div class="card-footer"><span class="badge badge-draft">Draft — ${phase}</span></div>
  <p class="action-hint">Resume with <code>/pm:groom</code></p>
</div>`
    });
  }

  // Sort newest first (draft pinned via 9999 date)
  entries.sort((a, b) => b.date.localeCompare(a.date));

  const totalCount = entries.length;
  const limited = limit ? entries.slice(0, limit) : entries;
  const cardsHtml = limited.map(e => e.html).join('\n');

  return { cardsHtml, totalCount };
}
```

Add `buildProposalCards` to exports. Also need `groomPhaseLabel` — it exists from PM-027 branch but NOT in this worktree (branched from main before PM-027 merged). If `groomPhaseLabel` is not in this worktree, add a local version. Check with: `grep -n groomPhaseLabel scripts/server.js`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern 'buildProposalCards' tests/server.test.js`
Expected: all 4 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: add buildProposalCards shared helper"
```

---

## Chunk 2: handleProposalsPage + handleProposalDetail + routes

### Task 3: Implement handleProposalsPage

**Files:**
- Modify: `scripts/server.js` (after buildProposalCards)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
test('GET /proposals with proposals returns card grid', async () => {
  const meta = { title: 'Test Proposal', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 3, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/test-proposal.meta.json': JSON.stringify(meta),
    'pm/backlog/proposals/test-proposal.html': '<html><body>Proposal content</body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('Test Proposal'), 'must show proposal title');
      assert.ok(body.includes('card-gradient'), 'must render gradient strip');
      assert.ok(body.includes('Ready'), 'must show verdict badge');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals empty shows groom hint', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('/pm:groom'), 'empty state must mention /pm:groom');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL (404 — route doesn't exist yet)

- [ ] **Step 3: Implement handleProposalsPage and add route**

```javascript
function handleProposalsPage(res, pmDir) {
  const { cardsHtml, totalCount } = buildProposalCards(pmDir, null);

  let body;
  if (totalCount === 0) {
    body = `<div class="page-header"><h1>Proposals</h1></div>
<div class="empty-state">
  <h2>No proposals yet</h2>
  <p>Run <code>/pm:groom</code> to create your first proposal.</p>
</div>`;
  } else {
    body = `<div class="page-header"><h1>Proposals</h1>
  <p class="subtitle">${totalCount} proposal${totalCount !== 1 ? 's' : ''}</p>
</div>
<div class="card-grid">${cardsHtml}</div>`;
  }

  const html = dashboardPage('Proposals', '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

Add route in `routeDashboard()` before the 404 fallback:
```javascript
} else if (url === '/proposals') {
  handleProposalsPage(res, pmDir);
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: add /proposals gallery route"
```

### Task 4: Implement handleProposalDetail

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
test('GET /proposals/{slug} serves raw proposal HTML', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/my-feature.html': '<html><body><h1>My Feature Proposal</h1></body></html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals/my-feature');
      assert.equal(statusCode, 200);
      assert.ok(body.includes('My Feature Proposal'), 'must serve the proposal HTML');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug} returns 404 for missing proposal', async () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { statusCode, body } = await httpGet(port, '/proposals/nonexistent');
      assert.equal(statusCode, 404);
      assert.ok(body.includes('/proposals'), 'must have back link');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('GET /proposals/{slug} rejects path traversal', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/legit.html': '<html>legit</html>',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const r1 = await httpGet(port, '/proposals/../../../etc/passwd');
      assert.equal(r1.statusCode, 404);
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement handleProposalDetail and add route**

```javascript
function handleProposalDetail(res, pmDir, slug) {
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/proposals', '<div class="empty-state"><p>Proposal not found.</p><p><a href="/proposals">← Back to Proposals</a></p></div>'));
    return;
  }
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const htmlPath = path.resolve(proposalsDir, slug + '.html');
  if (!htmlPath.startsWith(proposalsDir + path.sep) || !fs.existsSync(htmlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/proposals', '<div class="empty-state"><p>Proposal not found.</p><p><a href="/proposals">← Back to Proposals</a></p></div>'));
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

Add route in `routeDashboard()` after the `/proposals` route:
```javascript
} else if (url.startsWith('/proposals/')) {
  const slug = url.slice('/proposals/'.length).replace(/\/$/, '');
  handleProposalDetail(res, pmDir, slug);
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: add /proposals/{slug} detail handler serving raw HTML"
```

---

## Chunk 3: Home page modification + final verification

### Task 5: Add proposals section to home page

**Files:**
- Modify: `scripts/server.js` (`handleDashboardHome` at ~line 1225)
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
test('Home page shows proposal cards when proposals exist', async () => {
  const meta = { title: 'My Proposal', date: '2026-03-17', verdict: 'ready', verdictLabel: 'Ready', phase: 'completed', issueCount: 4, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', labels: [] };
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
    'pm/backlog/proposals/my-proposal.meta.json': JSON.stringify(meta),
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('My Proposal'), 'home page must show proposal card');
      assert.ok(body.includes('proposals-view-all') || body.includes('View all proposals'), 'must have View all link');
    } finally { await close(); }
  } finally { cleanup(); }
});

test('Home page has no proposal section when no proposals exist', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(!body.includes('Recent Proposals'), 'must not show proposal section');
      assert.ok(!body.includes('proposals-view-all'), 'must not have View all link');
    } finally { await close(); }
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Modify handleDashboardHome**

In `handleDashboardHome`, after the `projectName` line and before the `body` template literal, add:

```javascript
  // Proposal cards section
  let proposalsHtml = '';
  const { cardsHtml: proposalCards, totalCount: proposalCount } = buildProposalCards(pmDir, 6);
  if (proposalCards) {
    const viewAllText = proposalCount > 6
      ? `View all ${proposalCount} proposals →`
      : 'View all proposals →';
    proposalsHtml = `
<div class="content-section">
  <div class="proposals-header">
    <h2>Recent Proposals</h2>
    <a href="/proposals" class="proposals-view-all">${viewAllText}</a>
  </div>
  <div class="card-grid">${proposalCards}</div>
</div>`;
  }
```

Then modify the `body` template to include `${proposalsHtml}` between the page header and the KB card-grid:

```javascript
  const body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Knowledge base overview</p>
</div>
${proposalsHtml}
<div class="card-grid">${sections}</div>
${suggestedHtml}`;
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Run full test suite**

Run: `node --test tests/server.test.js`
Expected: all tests pass (36 existing + 10 new = ~46)

- [ ] **Step 6: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: add proposals section to dashboard home page"
```

### Task 6: Final verification and export cleanup

- [ ] **Step 1: Verify all new functions are exported**

Check exports include: `buildProposalCards`, `sanitizeGradient`. The route handlers (`handleProposalsPage`, `handleProposalDetail`) don't need to be exported (they're internal to the server).

- [ ] **Step 2: Run full test suite one final time**

Run: `node --test tests/server.test.js`
Expected: all pass, 0 fail

- [ ] **Step 3: Commit any final cleanup**

```bash
git add -A && git commit -m "chore: final cleanup and export verification"
```
