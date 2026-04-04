# PM-120: Home Page Redesign -- Implementation Plan

## Header

**Goal:** Replace the current Home page (pulse arc, stat cards, canvas tabs, KB accordion) with a clean status board: strategy snapshot, active proposals ("What's coming"), recently shipped, and KB health cards. F-pattern layout with 48px section spacing.

**Architecture:** Single-file server at `pm_plugin/scripts/server.js`. The entire `handleDashboardHome()` function is rewritten. Data sources already exist -- no new I/O patterns needed.

**Files modified:**
- `pm_plugin/scripts/server.js` -- `handleDashboardHome()` rewrite + new CSS
- `pm_plugin/tests/server.test.js` -- updated content assertions

**Done when:**
1. Strategy snapshot section shows: focus statement, top 3 priorities, freshness dot, "View full strategy" link
2. "What's coming" section shows active proposals as rows (ID, title, status badge, issue count, updated)
3. "Recently shipped" shows last 5 shipped items with title, context, date
4. KB health shows 3 metric cards (research topics + freshness, competitors + last updated, customer evidence count)
5. 48px section spacing, 8px card gaps, uppercase 13px section labels
6. Pulse score arc, stat card grid, canvas tabs, KB accordion all removed
7. Active session banners retained (they are still useful)
8. Empty state still works for fresh projects
9. All tests pass

**Verification:** `cd pm_plugin && node --test`

---

## Upstream Context (from PM-117 research)

- F-pattern: strategy (primary) top-left, proposals (secondary) below, shipped + KB as supporting
- 5-9 element cap per view; use "View all" links for overflow
- Section headers: 13px uppercase, 600 weight, `--text-muted`, with right-aligned link
- Cards: `--surface` bg, `--border` border, 8px radius, hover to `--surface-raised`
- Section spacing: 48px = `var(--space-12)` between major blocks
- Staleness dot: 6px circle, green/yellow/red

---

## Task Breakdown

### Task 1: TDD -- Write content structure tests

**Red:** Add tests asserting the Home page response:
- Contains `<span class="section-title">Strategy</span>`
- Contains `<span class="section-title">What's coming</span>`
- Contains `<span class="section-title">Recently shipped</span>`
- Contains `<span class="section-title">Knowledge base</span>`
- Does NOT contain `pulse-score` or `pulse-arc`
- Does NOT contain `stat-grid` or `stat-card`
- Does NOT contain `canvas-tabs`

### Task 2: Add new CSS classes to DASHBOARD_CSS

**File:** `server.js` (DASHBOARD_CSS constant)

Add the following CSS (matching the wireframe mockup tokens):

```css
/* ===== HOME SECTIONS ===== */
.section { margin-bottom: 48px; }
.section-header {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 16px;
}
.section-title {
  font-size: 13px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--text-muted);
}
.section-link {
  font-size: 13px; color: var(--accent); text-decoration: none; font-weight: 500;
}
.section-link:hover { color: var(--accent-hover, var(--accent)); }

/* Strategy snapshot */
.strategy-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 20px 24px;
}
.strategy-focus {
  font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
  margin-bottom: 12px; line-height: 1.4;
}
.strategy-priorities { display: flex; flex-direction: column; gap: 8px; }
.priority-item {
  display: flex; align-items: baseline; gap: 10px;
  font-size: 14px; color: var(--text-muted);
}
.priority-num {
  font-size: 12px; font-weight: 700; color: var(--accent);
  width: 20px; flex-shrink: 0;
}
.staleness {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-dim, var(--text-muted)); margin-top: 12px;
}
.staleness-dot { width: 6px; height: 6px; border-radius: 50%; }
.staleness-dot.fresh { background: var(--success, #4ade80); }
.staleness-dot.aging { background: var(--warning, #fb923c); }
.staleness-dot.stale { background: #ef4444; }

/* Proposal rows (home) */
.proposal-list { display: flex; flex-direction: column; gap: 8px; }
.proposal-row {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 16px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.proposal-row:hover { background: var(--surface-raised, var(--surface)); }
.proposal-row .proposal-id {
  font-size: 12px; font-weight: 600; color: var(--accent);
  font-variant-numeric: tabular-nums; width: 36px; flex-shrink: 0;
}
.proposal-row .proposal-title { font-size: 14px; font-weight: 500; flex: 1; }
.proposal-row .proposal-meta {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  display: flex; align-items: center; gap: 12px;
}

/* Shipped items (home) */
.home-shipped-list { display: flex; flex-direction: column; gap: 8px; }
.home-shipped-item {
  display: flex; align-items: baseline; gap: 12px;
  padding: 12px 16px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.home-shipped-item:hover { background: var(--surface-raised, var(--surface)); }
.home-shipped-title { font-size: 14px; font-weight: 500; flex: 1; }
.home-shipped-context { font-size: 12px; color: var(--text-dim, var(--text-muted)); }
.home-shipped-date {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* KB health grid */
.kb-health-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.kb-health-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px 20px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.kb-health-card:hover { background: var(--surface-raised, var(--surface)); }
.kb-health-value {
  font-size: 24px; font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.kb-health-label { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.kb-health-freshness {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-dim, var(--text-muted)); margin-top: 8px;
}
```

### Task 3: Rewrite `handleDashboardHome()` body (lines 3398-3671)

**File:** `server.js`
**Line range:** 3398-3671 (entire function)

The function body is completely replaced. Keep the same function signature. The new implementation:

1. **Read strategy.md** -- extract focus line (first paragraph or `## Focus` section) and top 3 priorities from `## Priorities` section. Compute staleness from file mtime.

2. **Read proposals** -- reuse `buildProposalCards()` but extract raw data instead of card HTML. Get active proposals (not shipped, not draft) sorted by date, take top 5. Each row: ID, title, status badge, issue count, relative date.

3. **Read shipped items** -- scan `pm/backlog/*.md` for `status: done` root items, sorted by date desc, take top 5. Each row: title, outcome (from frontmatter if available), date.

4. **Compute KB health** -- count research topics + freshness breakdown, competitor count + last updated, customer evidence count (from `pm/evidence/` if it exists).

5. **Session banners** -- keep the existing active session logic (lines 3510-3547), it's still relevant.

**New body template string:**

```js
// Strategy snapshot section
const strategySection = stats.strategy ? `
<div class="section">
  <div class="section-header">
    <span class="section-title">Strategy</span>
    <a href="/kb?tab=strategy" class="section-link">View full strategy</a>
  </div>
  <div class="strategy-card">
    <div class="strategy-focus">${escHtml(strategyFocus)}</div>
    <div class="strategy-priorities">
      ${priorities.map((p, i) => `<div class="priority-item"><span class="priority-num">${i + 1}</span> ${escHtml(p)}</div>`).join('')}
    </div>
    <div class="staleness">
      <span class="staleness-dot ${strategyStaleness.level}"></span>
      Updated ${escHtml(strategyStaleness.label)}
    </div>
  </div>
</div>` : '';

// What's coming section
const proposalsSection = activeProposals.length > 0 ? `
<div class="section">
  <div class="section-header">
    <span class="section-title">What's coming</span>
    <a href="/proposals" class="section-link">All proposals</a>
  </div>
  <div class="proposal-list">
    ${activeProposals.map(p => `<a href="/proposals/${escHtml(encodeURIComponent(p.slug))}" class="proposal-row">
      <span class="proposal-id">${escHtml(p.id || '')}</span>
      <span class="proposal-title">${escHtml(p.title)}</span>
      <span class="proposal-meta">
        <span class="badge badge-${escHtml(p.badgeClass)}">${escHtml(p.statusLabel)}</span>
        <span class="issue-count">${p.issueCount} issue${p.issueCount !== 1 ? 's' : ''}</span>
      </span>
    </a>`).join('')}
  </div>
</div>` : '';

// Recently shipped section
const shippedSection = recentShipped.length > 0 ? `
<div class="section">
  <div class="section-header">
    <span class="section-title">Recently shipped</span>
    <a href="/roadmap/shipped" class="section-link">All shipped</a>
  </div>
  <div class="home-shipped-list">
    ${recentShipped.map(s => `<a href="/roadmap/${escHtml(encodeURIComponent(s.slug))}" class="home-shipped-item">
      <span class="home-shipped-title">${escHtml(s.title)}</span>
      <span class="home-shipped-context">${escHtml(s.outcome || '')}</span>
      <span class="home-shipped-date">${escHtml(s.dateLabel)}</span>
    </a>`).join('')}
  </div>
</div>` : '';

// KB health section
const kbSection = `
<div class="section">
  <div class="section-header">
    <span class="section-title">Knowledge base</span>
    <a href="/kb" class="section-link">Browse</a>
  </div>
  <div class="kb-health-grid">
    <a href="/kb?tab=research" class="kb-health-card">
      <div class="kb-health-value">${stats.research}</div>
      <div class="kb-health-label">Research topics</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${researchFreshness.level}"></span>
        ${escHtml(researchFreshness.summary)}
      </div>
    </a>
    <a href="/kb?tab=competitors" class="kb-health-card">
      <div class="kb-health-value">${stats.competitors}</div>
      <div class="kb-health-label">Competitors profiled</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${competitorFreshness.level}"></span>
        ${escHtml(competitorFreshness.summary)}
      </div>
    </a>
    <a href="/kb?tab=research" class="kb-health-card">
      <div class="kb-health-value">${evidenceCount}</div>
      <div class="kb-health-label">Customer evidence</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${evidenceFreshness.level}"></span>
        ${escHtml(evidenceFreshness.summary)}
      </div>
    </a>
  </div>
</div>`;

body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Product knowledge base</p>
</div>
${sessionBannerHtml}
${strategySection}
${proposalsSection}
${shippedSection}
${kbSection}`;
```

### Task 4: Add strategy parsing helper

**File:** `server.js` (new helper, add near line 3396)

```js
function parseStrategySnapshot(pmDir) {
  const strategyPath = path.join(pmDir, 'strategy.md');
  if (!fs.existsSync(strategyPath)) return null;
  const raw = fs.readFileSync(strategyPath, 'utf-8');
  const { body } = parseFrontmatter(raw);

  // Extract focus: first non-empty paragraph or ## Focus section
  let focus = '';
  const focusMatch = body.match(/## (?:Focus|Vision)\s*\n+(.*?)(?:\n\n|\n##)/s);
  if (focusMatch) focus = focusMatch[1].replace(/\n/g, ' ').trim();
  if (!focus) {
    const firstPara = body.split(/\n\n/)[0];
    focus = firstPara.replace(/^#.*\n/, '').trim();
  }

  // Extract priorities from ## Priorities section
  const priorities = [];
  const priMatch = body.match(/## Priorities\s*\n([\s\S]*?)(?:\n##|$)/);
  if (priMatch) {
    const lines = priMatch[1].split('\n').filter(l => /^\s*[-*\d]/.test(l));
    for (const line of lines.slice(0, 3)) {
      priorities.push(line.replace(/^\s*[-*\d.]+\s*/, '').trim());
    }
  }

  const stale = stalenessInfo(getUpdatedDate(strategyPath));
  return { focus, priorities, staleness: stale || { level: 'fresh', label: 'Current' } };
}
```

### Task 5: Add shipped-with-context reader

Inside the rewritten `handleDashboardHome`, read shipped items and extract `outcome` from their frontmatter:

```js
const recentShipped = [];
if (fs.existsSync(backlogDir)) {
  const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
  const allItems = {};
  for (const file of files) {
    const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
    const { data } = parseFrontmatter(raw);
    const slug = file.replace('.md', '');
    allItems[slug] = { slug, ...data };
  }
  const childSlugs = new Set();
  for (const item of Object.values(allItems)) {
    if (item.parent && item.parent !== 'null' && allItems[item.parent]) childSlugs.add(item.slug);
  }
  const shipped = Object.values(allItems)
    .filter(i => i.status === 'done' && !childSlugs.has(i.slug))
    .sort((a, b) => ((b.updated || b.created || '') > (a.updated || a.created || '') ? 1 : -1))
    .slice(0, 5);
  for (const s of shipped) {
    const dateStr = s.updated || s.created || '';
    recentShipped.push({
      slug: s.slug,
      title: s.title || s.slug,
      outcome: s.outcome || '',
      dateLabel: formatRelativeDate(dateStr),
    });
  }
}
```

### Task 5b: Define `formatRelativeDate()` helper

**BLOCKING DEPENDENCY:** PM-121, PM-122, and PM-124 also call this function. It must be defined here (the first plan that needs it).

Add this helper function near the other date utilities in server.js (around the `stalenessInfo` function):

```javascript
function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}
```

Test:
```javascript
test('formatRelativeDate returns human-readable relative dates', () => {
  const now = new Date();
  assert.equal(formatRelativeDate(now.toISOString()), 'today');
  const yesterday = new Date(now - 86400000);
  assert.equal(formatRelativeDate(yesterday.toISOString()), 'yesterday');
  assert.equal(formatRelativeDate(''), '');
  assert.equal(formatRelativeDate(null), '');
});
```

### Task 6: Remove old pulse score, stat cards, canvas tabs, KB accordion

Remove from `handleDashboardHome`:
- `computePulseScore()` call and `pulseScoreHtml` (lines 3593-3623)
- `canvasTabsHtml` block (lines 3626-3637)
- `controlCards` block (lines 3569-3590)
- `kbReferenceHtml` block (lines 3473-3477)
- `suggestedHtml` block (lines 3503-3506) -- keep `suggestedNext` logic but render it inline as a subtle hint at the bottom, or remove entirely if the KB health cards serve the same purpose

### Task 7: Run tests and fix regressions

```bash
cd pm_plugin && node --test
```
